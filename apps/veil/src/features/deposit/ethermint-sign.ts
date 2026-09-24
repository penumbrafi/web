import {
  makeAuthInfoBytes,
  makeSignDoc,
  Registry,
  type EncodeObject,
  type OfflineDirectSigner,
} from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';

/**
 * Signing + broadcast for Ethermint source chains (Injective).
 *
 * cosmjs's SigningStargateClient cannot sign for these chains, for two
 * independent reasons:
 *
 *  1. Account lookup: Injective returns `/injective.types.v1beta1.EthAccount`,
 *     which cosmjs's default account parser rejects with
 *     "Unsupported type: '/injective.types.v1beta1.EthAccount'".
 *  2. Pubkey type: cosmjs always writes a `/cosmos.crypto.secp256k1.PubKey`
 *     into AuthInfo. Injective derives addresses Ethereum-style (keccak), so it
 *     requires `/injective.crypto.v1beta1.ethsecp256k1.PubKey`; a secp256k1
 *     pubkey fails the signer-address check even if (1) is patched.
 *
 * So for these chains we build the tx ourselves: account number/sequence from
 * the LCD's JSON (no protobuf account parsing), the ethsecp256k1 pubkey in
 * AuthInfo, and the wallet's `signDirect` for the signature. Keplr and Leap sign
 * Injective the Ethermint way (keccak256 over the SignDoc) natively. We also
 * talk to a fixed set of CORS-enabled LCDs instead of letting cosmos-kit walk
 * chain-registry's stale RPC list.
 */

interface EthermintChainConfig {
  /** CORS-enabled REST endpoints, tried in order. */
  lcd: string[];
  feeDenom: string;
  /** Fee per unit of gas, in base units of feeDenom. */
  gasPrice: bigint;
  /**
   * Gas sponsor (zafu apps/feegrant). When the sender cannot pay the fee, it
   * issues an x/feegrant allowance and the tx sets fee.granter, so users who
   * hold USDC.inj but no INJ can still shield.
   */
  sponsorUrl?: string;
}

const ETHERMINT_CHAINS: Record<string, EthermintChainConfig> = {
  'injective-1': {
    lcd: [
      'https://sentry.lcd.injective.network',
      'https://lcd.injective.network',
      'https://injective-rest.publicnode.com',
    ],
    feeDenom: 'inj',
    gasPrice: 500_000_000n,
    sponsorUrl: 'https://sponsor.zafu.pro',
  },
};

/** A MsgTransfer on Injective uses well under this; unused gas is not charged beyond the fee. */
const GAS_LIMIT = 400_000n;

const ETHSECP256K1_PUBKEY_TYPE_URL = '/injective.crypto.v1beta1.ethsecp256k1.PubKey';

export const isEthermintChain = (chainId: string | undefined): chainId is string =>
  chainId !== undefined && chainId in ETHERMINT_CHAINS;

// -- minimal protobuf encoding (length-delimited fields only) ---------------

const encodeVarint = (value: number): number[] => {
  const out: number[] = [];
  let n = value;
  while (n >= 128) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};

const lengthDelimited = (fieldNumber: number, bytes: Uint8Array): Uint8Array => {
  const tag = encodeVarint(fieldNumber * 8 + 2);
  const len = encodeVarint(bytes.length);
  const out = new Uint8Array(tag.length + len.length + bytes.length);
  out.set(tag, 0);
  out.set(len, tag.length);
  out.set(bytes, tag.length + len.length);
  return out;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** TxRaw { bytes body_bytes = 1; bytes auth_info_bytes = 2; repeated bytes signatures = 3; } */
const encodeTxRaw = (bodyBytes: Uint8Array, authInfoBytes: Uint8Array, signature: Uint8Array) =>
  concatBytes(
    lengthDelimited(1, bodyBytes),
    lengthDelimited(2, authInfoBytes),
    lengthDelimited(3, signature),
  );

const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s);
};

// -- LCD access --------------------------------------------------------------

/**
 * GET against the chain's LCDs, falling through to the next endpoint on a
 * network error or 5xx. A 4xx is a real answer (e.g. 404 = unknown account)
 * and is returned as-is.
 */
const lcdGet = async (cfg: EthermintChainConfig, path: string): Promise<Response> => {
  let lastError: unknown;
  for (const base of cfg.lcd) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.status < 500) {
        return res;
      }
      lastError = new Error(`${base} returned HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No Injective endpoint reachable');
};

const queryAccount = async (
  cfg: EthermintChainConfig,
  address: string,
): Promise<{ accountNumber: number; sequence: number }> => {
  const res = await lcdGet(cfg, `/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) {
    throw new Error(
      'This Injective address has never received funds, so there is nothing to shield.',
    );
  }
  if (!res.ok) {
    throw new Error(`Could not load the Injective account (HTTP ${res.status})`);
  }
  const json = (await res.json()) as {
    account?: {
      base_account?: { account_number?: string; sequence?: string };
      account_number?: string;
      sequence?: string;
    };
  };
  // EthAccount nests the standard fields under base_account; a plain
  // BaseAccount has them at the top level.
  const base = json.account?.base_account ?? json.account;
  if (base?.account_number === undefined || base.sequence === undefined) {
    throw new Error('Unexpected Injective account format');
  }
  return { accountNumber: Number(base.account_number), sequence: Number(base.sequence) };
};

const queryFeeBalance = async (cfg: EthermintChainConfig, address: string): Promise<bigint> => {
  const res = await lcdGet(
    cfg,
    `/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${cfg.feeDenom}`,
  );
  if (!res.ok) {
    throw new Error(`Could not load the gas balance (HTTP ${res.status})`);
  }
  const json = (await res.json()) as { balance?: { amount?: string } };
  return BigInt(json.balance?.amount ?? '0');
};

/** Ask the gas sponsor for a fee allowance. Resolves once the grant is on-chain. */
const requestFeeGrant = async (sponsorUrl: string, address: string): Promise<string> => {
  const res = await fetch(`${sponsorUrl}/v1/injective/grant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const json = (await res.json().catch(() => ({}))) as { granter?: string; error?: string };
  if (!res.ok || !json.granter) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.granter;
};

/**
 * Broadcast in SYNC mode. Only a network-level failure moves on to the next
 * endpoint: once any node answers, that answer is final (re-sending the same
 * signed tx elsewhere would at best be rejected as a duplicate).
 */
const broadcastTx = async (cfg: EthermintChainConfig, txBytes: Uint8Array): Promise<string> => {
  const body = JSON.stringify({ tx_bytes: toBase64(txBytes), mode: 'BROADCAST_MODE_SYNC' });
  let lastError: unknown;
  for (const base of cfg.lcd) {
    let res: Response;
    try {
      res = await fetch(`${base}/cosmos/tx/v1beta1/txs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    } catch (e) {
      lastError = e;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as {
      tx_response?: { code?: number; txhash?: string; raw_log?: string };
      message?: string;
    };
    const tr = json.tx_response;
    if (!res.ok || !tr?.txhash) {
      throw new Error(`Injective broadcast failed: ${json.message ?? `HTTP ${res.status}`}`);
    }
    if (tr.code !== 0) {
      throw new Error(`Injective rejected the transfer (code ${tr.code}): ${tr.raw_log ?? ''}`);
    }
    return tr.txhash;
  }
  throw lastError instanceof Error ? lastError : new Error('No Injective endpoint reachable');
};

// -- sign + broadcast --------------------------------------------------------

export const signAndBroadcastEthermint = async ({
  chainId,
  signer,
  address,
  messages,
  memo,
}: {
  chainId: string;
  signer: OfflineDirectSigner;
  address: string;
  messages: EncodeObject[];
  memo: string;
}): Promise<{ txHash: string }> => {
  const cfg = ETHERMINT_CHAINS[chainId];
  if (!cfg) {
    throw new Error(`${chainId} is not an Ethermint chain`);
  }

  const account = (await signer.getAccounts()).find(a => a.address === address);
  if (!account) {
    throw new Error(`The connected wallet has no key for ${address}`);
  }
  if (account.pubkey.length !== 33) {
    throw new Error('The connected wallet returned an unexpected public key');
  }

  const { accountNumber, sequence } = await queryAccount(cfg, address);

  // Not enough of the fee token for gas: have the sponsor pay it via
  // fee.granter. It only covers IBC transfers, for addresses holding USDC.inj.
  const fee = cfg.gasPrice * GAS_LIMIT;
  let feeGranter: string | undefined;
  if ((await queryFeeBalance(cfg, address)) < fee) {
    const need = `${Number(fee) / 1e18} ${cfg.feeDenom.toUpperCase()}`;
    if (!cfg.sponsorUrl) {
      throw new Error(`Not enough ${cfg.feeDenom.toUpperCase()} for gas (needs ~${need}).`);
    }
    try {
      feeGranter = await requestFeeGrant(cfg.sponsorUrl, address);
    } catch (e) {
      throw new Error(
        `Not enough ${cfg.feeDenom.toUpperCase()} for gas (needs ~${need}), and the gas sponsor could not cover it: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const bodyBytes = new Registry(defaultRegistryTypes).encodeTxBody({ messages, memo });
  const authInfoBytes = makeAuthInfoBytes(
    [
      {
        // PubKey { bytes key = 1; } under the Ethermint type URL
        pubkey: {
          typeUrl: ETHSECP256K1_PUBKEY_TYPE_URL,
          value: lengthDelimited(1, account.pubkey),
        },
        sequence,
      },
    ],
    [{ denom: cfg.feeDenom, amount: fee.toString() }],
    Number(GAS_LIMIT),
    feeGranter,
    undefined,
  );
  const signDoc = makeSignDoc(bodyBytes, authInfoBytes, chainId, accountNumber);

  // The wallet may adjust the fee in its approval UI, so broadcast exactly
  // what it signed rather than our original bytes.
  const { signed, signature } = await signer.signDirect(address, signDoc);
  const txBytes = encodeTxRaw(
    signed.bodyBytes,
    signed.authInfoBytes,
    fromBase64(signature.signature),
  );

  try {
    return { txHash: await broadcastTx(cfg, txBytes) };
  } catch (e) {
    // The grant is in a block the sponsor's node has seen but this node may
    // not have yet. A CheckTx rejection consumes no sequence, so the same
    // signed bytes can be resent once.
    if (!feeGranter || !(e instanceof Error) || !/fee-grant not found/i.test(e.message)) {
      throw e;
    }
    await new Promise<void>(resolve => {
      setTimeout(resolve, 3000);
    });
    return { txHash: await broadcastTx(cfg, txBytes) };
  }
};

import { Transaction } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { uint8ArrayToBase64 } from '@penumbra-zone/types/base64';
import { uint8ArrayToHex, hexToUint8Array } from '@penumbra-zone/types/hex';
import type {
  BroadcastApiResponse,
  BroadcastApiSuccess,
} from '@/shared/api/server/broadcast';
import { txToId } from '../model/tx-to-id';
import { penumbra } from '@/shared/const/penumbra';
import { ViewService } from '@penumbra-zone/protobuf';
import { TransactionId } from '@penumbra-zone/protobuf/penumbra/core/txhash/v1/txhash_pb';

export interface VeilBroadcastResult {
  txHash: string;
  detectionHeight?: bigint;
  /**
   * `true` when the local wallet's view service has observed the tx.
   * When this is `false` after `awaitDetection`, the tx probably IS on
   * chain (tendermint accepted it) but the wallet hasn't scanned that
   * block yet — the caller must NOT plan a swapClaim off it, and MUST
   * NOT let the user resubmit (double-swap risk).
   */
  viewSeen: boolean;
}

/**
 * The broadcast reached tendermint AND tendermint's response is final —
 * either it committed to a block or was rejected outright (code≠0,
 * mismatched hash). The transaction is either on chain or definitively
 * not, so retrying via the wallet would just double-broadcast an
 * already-landed tx or repeat a stateless-check failure. `planBuildBroadcast`
 * uses this to skip the wallet fallback for terminal cases.
 */
export class VeilBroadcastTerminalError extends Error {
  readonly kind: 'rejected' | 'hash-mismatch' | 'landed';
  constructor(kind: 'rejected' | 'hash-mismatch' | 'landed', message: string) {
    super(message);
    this.name = 'VeilBroadcastTerminalError';
    this.kind = kind;
  }
}

const isSuccess = (json: BroadcastApiResponse): json is BroadcastApiSuccess => 'hash' in json;

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;
// The local view service takes a couple of seconds to scan a new block
// after the tx lands. Poll faster here since it's a local RPC, not HTTP.
const VIEW_POLL_INTERVAL_MS = 750;
const VIEW_POLL_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const pollDetection = async (txHash: string, signal?: AbortSignal): Promise<bigint | undefined> => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return undefined;
    }
    try {
      const res = await fetch(`/api/transactions/${txHash}`, { signal });
      if (res.ok) {
        const data = (await res.json()) as { tx: string; height: number | string };
        return BigInt(data.height);
      }
    } catch {
      /* empty */
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return undefined;
};

/**
 * Wait for the LOCAL view service (in the wallet extension) to have
 * observed the transaction. Veil's own `/api/transactions/{hash}` shows
 * the tx exists on-chain, but the wallet's view service is what holds
 * the note set — including the `SwapRecord` a follow-up swapClaim
 * planner reads. Without this wait, the caller can plan a claim before
 * the extension has scanned the block and gets back "Swap record not
 * found", which the toast then surfaces as "Swap confirmed — claim
 * pending" (better than the old "retry" message, but still leaves the
 * claim un-issued until the next user action).
 *
 * Returns `true` if the view service saw the tx within the timeout,
 * `false` on timeout. Never throws — the caller can decide what to do
 * with a slow scanner (still enqueue the claim, or defer to the wallet).
 */
const pollViewService = async (txHash: string, signal?: AbortSignal): Promise<boolean> => {
  const id = new TransactionId({ inner: hexToUint8Array(txHash) });
  const deadline = Date.now() + VIEW_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return false;
    }
    try {
      const res = await penumbra.service(ViewService).transactionInfoByHash({ id });
      if (res.txInfo) {
        return true;
      }
    } catch {
      // Not visible yet — keep polling.
    }
    await sleep(VIEW_POLL_INTERVAL_MS);
  }
  return false;
};

export const veilBroadcastTransaction = async (
  transaction: Transaction,
  options: {
    awaitDetection: boolean;
    onBroadcastSuccess?: (txHash: string) => void;
    signal?: AbortSignal;
  },
): Promise<VeilBroadcastResult> => {
  const expectedId = await txToId(transaction);
  const expectedHashHex = uint8ArrayToHex(expectedId.inner);
  const txBase64 = uint8ArrayToBase64(transaction.toBinary());

  const res = await fetch('/api/penumbra/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx: txBase64 }),
    signal: options.signal,
  });

  if (!res.ok) {
    // Transport-level failure — safe to fall back to the wallet path.
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `veil broadcast failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as BroadcastApiResponse;
  if (!isSuccess(body)) {
    // Server-side broadcast error before tendermint had a chance to accept.
    throw new Error(body.error);
  }

  const returnedHashHex = body.hash.toLowerCase();
  if (returnedHashHex !== expectedHashHex) {
    // Something is deeply wrong — DON'T fall back and re-broadcast, that
    // would just try again with the same bytes and hit the same mismatch,
    // OR broadcast a tx we can't identify. Terminal.
    throw new VeilBroadcastTerminalError(
      'hash-mismatch',
      `broadcast transaction id disagrees: expected ${expectedHashHex} but tendermint ${returnedHashHex}`,
    );
  }

  if (body.code !== 0) {
    // Tendermint rejected the tx (stateless check failure, insufficient
    // fee, etc.). Retrying via the wallet would produce the same rejection
    // OR — if tendermint's cache still has it — "tx already exists in
    // cache". Neither is recoverable. Terminal.
    throw new VeilBroadcastTerminalError(
      'rejected',
      `tendermint rejected transaction (code ${body.code}${body.codespace ? `/${body.codespace}` : ''}): ${body.log}`,
    );
  }

  options.onBroadcastSuccess?.(expectedHashHex);

  if (!options.awaitDetection) {
    return { txHash: expectedHashHex, viewSeen: false };
  }

  // Two-phase detection:
  // 1. LOCAL view service (fast, ~2-4s) — this is what the swapClaim
  //    planner needs; without it "Swap record not found" fires.
  // 2. veil server DB — gives us `detectionHeight` for the receipt toast.
  //
  // Historically this was `Promise.all`, which floors on the SLOWER path —
  // when pindexer lags (it does, per ops notes), every swap sat 60s
  // waiting on `pollDetection` even though the wallet saw the tx in one
  // block and could have issued the claim immediately. Fire both, keep
  // whichever `detectionHeight` we can get, but let the view-service
  // observation gate `viewSeen`.
  const detectionP = pollDetection(expectedHashHex, options.signal).catch(() => undefined);
  const viewSeen = await pollViewService(expectedHashHex, options.signal);
  const detectionHeight = await detectionP;
  return { txHash: expectedHashHex, detectionHeight, viewSeen };
};

import { ChainProvider } from '@cosmos-kit/react';
// Trim wallet adapters to the two extensions Penumbra users actually
// reach for. The barrel `import { wallets } from 'cosmos-kit'` pulls
// every adapter in the cosmos-kit family — ~15 extensions plus mobile
// wallets — each with its own SDK and chain-id list. Keplr + Leap are
// the dominant Cosmos wallets; users on other adapters can still
// connect through Keplr's interchain compatibility.
import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension';
import { wallets as leapWallets } from '@cosmos-kit/leap-extension';
import { zafuWallet } from './zafu-wallet';
import { ReactNode, useMemo } from 'react';
import type { Chain as CosmosChain } from '@chain-registry/types';
import { Chain, Registry as PenumbraRegistry } from '@penumbrafi/registry';
import { GasPrice } from '@cosmjs/stargate';
import '@interchain-ui/react/styles';

import { SUPPORTED_CHAINS, SUPPORTED_ASSETS } from './supported-chains';

/**
 * Per-chain gas price for cosmos-kit's signing clients.
 *
 * Without this, `getSigningStargateClient()` hands back a client with no
 * `gasPrice`, and any `signAndBroadcast(..., 'auto', ...)` throws
 * "Gas price must be set in the client options when auto gas is used" —
 * which is exactly what the Shield flow hit. `'auto'` only simulates gas;
 * it still needs a price to turn gas units into a fee, and cosmos-kit does
 * not invent one.
 *
 * Read from the chain-registry entry rather than hardcoded, so a chain added
 * to SUPPORTED_CHAINS works without touching this file. `average_gas_price`
 * is the registry's own recommended tier, with the cheaper tiers as
 * fallbacks for chains that omit it.
 */
const gasPriceForChain = (chain: CosmosChain): GasPrice | undefined => {
  const feeToken = chain.fees?.fee_tokens[0];
  if (!feeToken?.denom) {
    return undefined;
  }
  const price =
    feeToken.average_gas_price ?? feeToken.low_gas_price ?? feeToken.fixed_min_gas_price;
  if (price === undefined) {
    return undefined;
  }
  return GasPrice.fromString(`${price}${feeToken.denom}`);
};

// cosmos-kit has passed either the chain object or its name here across
// versions; accept both rather than depend on which one this release does.
const resolveChain = (chain: CosmosChain | string): CosmosChain | undefined =>
  typeof chain === 'string'
    ? SUPPORTED_CHAINS.find(c => c.chain_name === chain || c.chain_id === chain)
    : chain;

const signerOptions = {
  signingStargate: (chain: CosmosChain | string) => {
    const resolved = resolveChain(chain);
    const gasPrice = resolved && gasPriceForChain(resolved);
    return gasPrice ? { gasPrice } : undefined;
  },
};

interface IbcProviderProps {
  registry: PenumbraRegistry;
  children: ReactNode;
}

export const IbcChainProvider = ({ registry, children }: IbcProviderProps) => {
  const chainsToDisplay = useMemo(
    () => chainsInPenumbraRegistry(registry.ibcConnections),
    [registry],
  );

  return (
    <ChainProvider
      throwErrors={false}
      chains={chainsToDisplay}
      assetLists={SUPPORTED_ASSETS}
      // Zafu (its transparent wallets), Keplr and Leap. Extensions only; no
      // WalletConnect (a centralized hosted service that requires an account).
      wallets={[zafuWallet, ...keplrWallets, ...leapWallets]}
      signerOptions={signerOptions}
      modalTheme={{ defaultTheme: 'light' }}
      logLevel={'NONE'}
    >
      {children}
    </ChainProvider>
  );
};

// Searches the locally-imported chain set for chains that have IBC
// connections to Penumbra. Doubles as a safety net: if a chain is in
// our import list but not in the live registry's IBC connections, it
// won't appear in the wallet picker.
export const chainsInPenumbraRegistry = (ibcConnections: Chain[]): CosmosChain[] => {
  return SUPPORTED_CHAINS.filter(c => ibcConnections.some(i => c.chain_id === i.chainId));
};

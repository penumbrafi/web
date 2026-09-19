import { ChainProvider } from '@cosmos-kit/react';
// Trim wallet adapters to the two extensions Penumbra users actually
// reach for. The barrel `import { wallets } from 'cosmos-kit'` pulls
// every adapter in the cosmos-kit family — ~15 extensions plus mobile
// wallets — each with its own SDK and chain-id list. Keplr + Leap are
// the dominant Cosmos wallets; users on other adapters can still
// connect through Keplr's interchain compatibility.
import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension';
import { wallets as leapWallets } from '@cosmos-kit/leap-extension';
import { ReactNode, useMemo } from 'react';
import type { Chain as CosmosChain } from '@chain-registry/types';
import { Chain, Registry as PenumbraRegistry } from '@penumbrafi/registry';
import '@interchain-ui/react/styles';

import { SUPPORTED_CHAINS, SUPPORTED_ASSETS } from './supported-chains';

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
      // Keplr + Leap only. Both extensions; no WalletConnect (which
      // is a centralized hosted service that requires an account).
      wallets={[...keplrWallets, ...leapWallets]}
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

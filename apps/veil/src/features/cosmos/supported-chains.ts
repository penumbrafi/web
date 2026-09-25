// Cosmos chains Penumbra exposes for IBC in veil. Scoped to Injective + Noble:
//
// Injective (channel-18 on the Penumbra side, channel-494 on the Injective
// side) is the recommended deposit path. It carries native USDC, AUSD, USDT
// and INJ, and it is reachable directly from an exchange withdrawal, so it is
// the shortest route in for most users.
//
// Noble is Circle's USDC issuance + CCTP hub in Cosmos and stays supported:
// it is still the source chain for the USDC already shielded on Penumbra.
// Penumbra enforces "unshield only to the asset's source chain", so
// Noble-sourced assets can only return to Noble, and Injective-sourced assets
// only to Injective.
//
// Importing per-chain instead of the `chain-registry` barrel saves ~3-4MB of
// bundle (the barrel contains all ~250 Cosmos chains).
//
// Re-enabling a chain: add its import + entry to both arrays below, AND ensure
// Penumbra has a live IBC connection (chain-provider.tsx filters out chains
// with no connection at runtime).

import * as injective from 'chain-registry/mainnet/injective';
import * as noble from 'chain-registry/mainnet/noble';

import type { Chain, AssetList } from '@chain-registry/types';

// chain-registry's per-chain modules are untyped (any); pin them to its types
export const SUPPORTED_CHAINS: Chain[] = [injective.chain as Chain, noble.chain as Chain];

export const SUPPORTED_ASSETS: AssetList[] = [
  injective.assets as AssetList,
  noble.assets as AssetList,
];

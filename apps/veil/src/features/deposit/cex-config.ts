/**
 * Hand-curated map of centralized exchanges → asset + network combos that
 * we can actually shield from today. Only combinations that satisfy BOTH:
 *   (a) the exchange lets a user withdraw the asset over that network to a
 *       standard Cosmos wallet address (inj1…, noble1…), and
 *   (b) Penumbra's registry indexes the corresponding
 *       `transfer/<penumbra-channel>/<sourceDenom>` — verified against the
 *       bundled `@penumbrafi/registry` (2026-09).
 *
 * DO NOT add a route without checking both. Users who copy the wrong
 * network from an exchange lose funds; users who send an unindexed denom
 * end up with an unrecognized shielded balance we cannot restore metadata
 * for.
 *
 * Verified indexed denoms (against @penumbrafi/registry bundled data):
 *   - transfer/channel-18/inj                                            (Injective INJ)
 *   - transfer/channel-18/erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a (Injective USDC)
 *   - transfer/channel-18/peggy0xdAC17F958D2ee523a2206206994597C13D831ec7 (Injective USDT)
 *   - transfer/channel-2/uusdc                                           (Noble USDC)
 *
 * Ordering rationale: sorted by CEX user-share (Binance → Coinbase →
 * Kraken → OKX → Bybit → KuCoin → Gate.io → MEXC → Bitget). Users are
 * far more likely to find their own exchange near the top than scrolling
 * an alphabetized list.
 *
 * minDeposit / estimatedArrival are conservative starting values — treat
 * them as TODO-verify against each exchange's live withdrawal page rather
 * than authoritative.
 */

export interface CexAsset {
  /** Display symbol (INJ, USDC, USDT). */
  symbol: string;
  /** Human-friendly network name shown to the user (Injective, Noble). */
  network: string;
  /** Source chain id — passes through to `useIbcShield` and matches
   *  Penumbra's `ibcConnections[].chainId`. */
  chainId: string;
  /** On-chain denom on the SOURCE chain. Must match the denom Penumbra
   *  indexes as `transfer/<penumbra-channel>/<sourceDenom>`. */
  sourceDenom: string;
  /** Display units. Used to hint the user; not enforced. */
  minDeposit: number;
  /** Free-text expectation, e.g. '30-60s'. */
  estimatedArrival: string;
  /** Optional per-row warning shown next to the destination address. */
  note?: string;
}

export interface CexConfig {
  id: string;
  name: string;
  /** SVG path served from /public. Files are not required for MVP; the
   *  UI falls back to a text avatar. */
  logoUrl?: string;
  assets: CexAsset[];
}

const INJ = (extras: Partial<CexAsset> = {}): CexAsset => ({
  symbol: 'INJ',
  network: 'Injective',
  chainId: 'injective-1',
  sourceDenom: 'inj',
  minDeposit: 0.1,
  estimatedArrival: '30-60s',
  note: 'Only withdraw over the Injective network.',
  ...extras,
});

const USDC_INJECTIVE = (extras: Partial<CexAsset> = {}): CexAsset => ({
  symbol: 'USDC',
  network: 'Injective',
  chainId: 'injective-1',
  // Injective's native USDC lives as an ERC-20 style denom string.
  sourceDenom: 'erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a',
  minDeposit: 5,
  estimatedArrival: '30-60s',
  note: 'Only withdraw over the Injective network.',
  ...extras,
});

const USDT_INJECTIVE = (extras: Partial<CexAsset> = {}): CexAsset => ({
  symbol: 'USDT',
  network: 'Injective',
  chainId: 'injective-1',
  // Peggy-bridged USDT on Injective.
  sourceDenom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
  minDeposit: 5,
  estimatedArrival: '30-60s',
  note: 'Only withdraw over the Injective network.',
  ...extras,
});

const USDC_NOBLE = (extras: Partial<CexAsset> = {}): CexAsset => ({
  symbol: 'USDC',
  network: 'Noble',
  chainId: 'noble-1',
  sourceDenom: 'uusdc',
  minDeposit: 5,
  estimatedArrival: '30-60s',
  note: 'Only withdraw over the Noble network.',
  ...extras,
});

export const CEX_CONFIG: CexConfig[] = [
  {
    id: 'binance',
    name: 'Binance',
    logoUrl: '/assets/cex/binance.svg',
    assets: [INJ(), USDT_INJECTIVE(), USDC_INJECTIVE()],
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    logoUrl: '/assets/cex/coinbase.svg',
    // Ethereum-native USDC via Noble bridge needs Skip and is deferred to
    // phase 2 per the roll-out plan.
    assets: [USDC_NOBLE()],
  },
  {
    id: 'kraken',
    name: 'Kraken',
    logoUrl: '/assets/cex/kraken.svg',
    // ATOM on Cosmos Hub route is skipped: the Penumbra <> Cosmos Hub
    // channel is expired in the current registry.
    assets: [INJ(), USDC_INJECTIVE()],
  },
  {
    id: 'okx',
    name: 'OKX',
    logoUrl: '/assets/cex/okx.svg',
    assets: [INJ(), USDT_INJECTIVE(), USDC_INJECTIVE()],
  },
  {
    id: 'bybit',
    name: 'Bybit',
    logoUrl: '/assets/cex/bybit.svg',
    assets: [INJ(), USDT_INJECTIVE()],
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    logoUrl: '/assets/cex/kucoin.svg',
    assets: [INJ()],
  },
  {
    id: 'gateio',
    name: 'Gate.io',
    logoUrl: '/assets/cex/gateio.svg',
    assets: [INJ(), USDT_INJECTIVE()],
  },
  {
    id: 'mexc',
    name: 'MEXC',
    logoUrl: '/assets/cex/mexc.svg',
    assets: [INJ()],
  },
  {
    id: 'bitget',
    name: 'Bitget',
    logoUrl: '/assets/cex/bitget.svg',
    assets: [INJ()],
  },
];

export const getCexConfigById = (id: string | undefined | null): CexConfig | undefined =>
  CEX_CONFIG.find(c => c.id === id);

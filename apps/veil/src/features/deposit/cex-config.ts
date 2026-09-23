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
 * Noble is deprecated as a deposit path (Circle winding down Noble USDC;
 * USDC.inj via Injective is the replacement). Do NOT re-add Noble here.
 *
 * Verified indexed denoms (against @penumbrafi/registry bundled data):
 *   - transfer/channel-18/inj                                            (Injective INJ)
 *   - transfer/channel-18/erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a (Injective USDC)
 *   - transfer/channel-18/peggy0xdAC17F958D2ee523a2206206994597C13D831ec7 (Injective USDT)
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
   *  UI falls back to a colored text avatar seeded by `brandColor`. */
  logoUrl?: string;
  /** Background color for the text-avatar fallback. Public brand colors
   *  (Wikipedia infoboxes / brand pages). Kept as CSS-ready strings so
   *  the picker never touches trademarked SVGs — a colored monogram is
   *  enough for a user to recognize their exchange in the list. */
  brandColor?: string;
  /** Text color that reads on brandColor. */
  brandColorContrast?: 'light' | 'dark';
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

// USDT.inj (Peggy) helper removed — no CEX currently confirms USDT
// withdrawal specifically over the Injective network in their public
// docs. Add back with an explicit source when we verify one.
// const USDT_INJECTIVE = (extras: Partial<CexAsset> = {}): CexAsset => ({
//   symbol: 'USDT',
//   network: 'Injective',
//   chainId: 'injective-1',
//   sourceDenom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
//   ...
// });

// Noble is deprecated as a deposit path — Circle is winding down Noble
// USDC (see shared/config/sunsetting-assets.ts) and USDC.inj is the
// replacement destination for shielded USDC. We do NOT surface Noble
// anywhere in the deposit picker; new deposits should land as USDC.inj
// via Injective. Existing shielded Noble USDC still exists as a balance
// on /portfolio and can be withdrawn (or later, swapped to USDC.inj).

// Per Sept 2026 research (see market-research audit): most CEXes only
// confirm INJ over the Injective network in their public withdrawal
// docs. USDT.inj (Peggy) and USDC.inj (Circle-issued, live since
// Vulcan v1.20.0, 2026-06-09) haven't yet appeared in most exchanges'
// published network lists — treat those rows as "confirmed live in a
// public source" only. Every "assumed but not evidenced" row was
// trimmed rather than risk sending a user to a network dropdown that
// doesn't have the option. Add a row back once a live withdrawal
// dropdown check confirms it.
export const CEX_CONFIG: CexConfig[] = [
  {
    id: 'binance',
    name: 'Binance',
    brandColor: '#F0B90B',
    brandColorContrast: 'dark',
    // USDC.inj / USDT.inj on Binance not confirmed against a public
    // source (Binance routes USDC-to-Injective through CCTP/Ethereum
    // in help docs). Keeping INJ only until verified.
    assets: [INJ()],
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    brandColor: '#0052FF',
    brandColorContrast: 'light',
    // INJ from Coinbase lands as native INJ on Injective EVM (migration
    // completed 2026-07-22; ERC-20 INJ retired). USDC on Injective from
    // Coinbase is NOT supported — Coinbase USDC networks remain
    // ETH/Base/Solana/Polygon/Arbitrum.
    assets: [INJ()],
  },
  {
    id: 'kraken',
    name: 'Kraken',
    brandColor: '#5741D9',
    brandColorContrast: 'light',
    // USDC on Injective at Kraken added 2026-07 per blog.kraken.com —
    // one of the few CEXes with a confirmed USDC.inj route today.
    assets: [INJ(), USDC_INJECTIVE()],
  },
  {
    id: 'okx',
    name: 'OKX',
    brandColor: '#000000',
    brandColorContrast: 'light',
    // OKX's public USDT/USDC network lists don't include Injective.
    // Trim to INJ pending live-dropdown confirmation.
    assets: [INJ()],
  },
  {
    id: 'bybit',
    name: 'Bybit',
    brandColor: '#F7A600',
    brandColorContrast: 'dark',
    assets: [INJ()],
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    brandColor: '#24AE8F',
    brandColorContrast: 'light',
    // Mainnet Injective INJ only; BEP20 INJ permanently closed 2023.
    assets: [INJ()],
  },
  {
    id: 'gateio',
    name: 'Gate.io',
    brandColor: '#2354E6',
    brandColorContrast: 'light',
    assets: [INJ()],
  },
  {
    id: 'mexc',
    name: 'MEXC',
    brandColor: '#00B897',
    brandColorContrast: 'light',
    assets: [INJ()],
  },
  {
    id: 'bitget',
    name: 'Bitget',
    brandColor: '#00F0FF',
    brandColorContrast: 'dark',
    // INJ-INJECTIVE deposits/withdrawals reopened 2026-09-05 post
    // exploit-triggered pause.
    assets: [INJ()],
  },
];

export const getCexConfigById = (id: string | undefined | null): CexConfig | undefined =>
  CEX_CONFIG.find(c => c.id === id);

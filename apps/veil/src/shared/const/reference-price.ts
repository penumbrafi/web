/**
 * Per-asset `reference_price` intel: what we consider "fair value in USD"
 * for each known asset, used by the LP form to suggest a smart mid for
 * new positions. The chain has no concept of price — this is purely UI —
 * so this is our opinion about what to prefill the reference-price input
 * with. Users always override.
 *
 * STOPGAP: this map lives in veil for now. Long-term it belongs on the
 * registry (as e.g. `reference_price` on each asset entry) so veil, zafu,
 * and third-party wallets all share the same intel and adding a new
 * asset doesn't need a veil PR. Keep the shape source-agnostic so the
 * registry field can carry either a fixed number or an external id
 * (currently CoinGecko, but any provider fits).
 *
 * Symbols are matched case-insensitively against the registry
 * `Metadata.symbol` we already have.
 */

export type ReferencePriceSource =
  | { kind: 'fixed'; usd: number }
  | { kind: 'coingecko'; id: string }
  // Derived USD price via an on-chain route through a fixed-price bridge
  // asset. `through` is an ORDERED fallback list of registry symbols we
  // try in turn — each bridge must resolve via referencePriceFor() to a
  // `{ kind: 'fixed' }` (typo → hard error server-side, never a silent
  // lie). Server takes the geometric mean of a $500-notional depth-fill
  // VWAP on each side; skips bridges without ≥$1k combined depth or with
  // a >20% buy/sell cross. See /api/derived-usd-price.
  | { kind: 'onchain-bridge'; through: string[] };

// Note the symbols are the on-chain penumbra registry symbols, not the
// CoinGecko display names — e.g. USDC.inj is our IBC-injective USDC, but
// on CoinGecko it's the same underlying asset priced at 1.0 as any
// bridged USDC. Bridged variants of the same underlier pin to the same
// source.
export const REFERENCE_PRICES: Record<string, ReferencePriceSource> = {
  // Stablecoins → fixed 1.0. A hair away from 1 is possible on paper but
  // meaningless for LP defaults; users can override.
  USDC: { kind: 'fixed', usd: 1 },
  'USDC.inj': { kind: 'fixed', usd: 1 },
  USDT: { kind: 'fixed', usd: 1 },
  'USDT.inj': { kind: 'fixed', usd: 1 },
  DAI: { kind: 'fixed', usd: 1 },
  PYUSD: { kind: 'fixed', usd: 1 },

  // UM has no live external listing (see history in git). We derive its
  // USD price from the on-chain route book via a stable bridge instead:
  // route $500-notional depth-fill both directions through USDC.inj,
  // fall back to USDT.inj / USDC.axl if the first is too thin. The
  // /api/derived-usd-price endpoint owns the math; here we just point at
  // the bridges. Users trading UM/X thus get an anchor even without any
  // external oracle.
  UM: { kind: 'onchain-bridge', through: ['USDC.inj', 'USDT.inj', 'USDC.axl'] },

  INJ: { kind: 'coingecko', id: 'injective-protocol' },
  BTC: { kind: 'coingecko', id: 'bitcoin' },
  WBTC: { kind: 'coingecko', id: 'wrapped-bitcoin' },
  ETH: { kind: 'coingecko', id: 'ethereum' },
  WETH: { kind: 'coingecko', id: 'weth' },
  ATOM: { kind: 'coingecko', id: 'cosmos' },
  OSMO: { kind: 'coingecko', id: 'osmosis' },
  TIA: { kind: 'coingecko', id: 'celestia' },
  SOL: { kind: 'coingecko', id: 'solana' },
};

/**
 * Look up an asset's reference price source. Case-insensitive on symbol.
 * Returns undefined if we don't have intel for this asset — caller should
 * fall back to the live-derived mid.
 */
export const referencePriceFor = (symbol: string | undefined): ReferencePriceSource | undefined => {
  if (!symbol) return undefined;
  const direct = REFERENCE_PRICES[symbol];
  if (direct) return direct;
  const ci = Object.keys(REFERENCE_PRICES).find(k => k.toLowerCase() === symbol.toLowerCase());
  return ci ? REFERENCE_PRICES[ci] : undefined;
};

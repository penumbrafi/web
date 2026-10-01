import BigNumber from 'bignumber.js';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { bech32mAssetId } from '@penumbra-zone/bech32m/passet';

// Pure market logic for the CoinGecko endpoints: which pairs are markets,
// which way round they are quoted, and how pindexer's rows turn into a
// ticker. No next/server, pd or database imports, so vitest can drive it.
//
// Units, from pindexer's dex_ex (crates/bin/pindexer/src/dex_ex/mod.rs). For
// a summary row (start, end):
//   - `price` is end base units per start base unit;
//   - `direct_volume_over_window` is in START base units, and every trace
//     on the pair adds to both (start, end) and (end, start), so row (b, q)
//     is the pair's whole base volume and row (q, b) its whole quote volume;
//   - `liquidity` is the END asset's reserves across the pair's positions.

/** The summary columns a ticker is built from, plus the snapshot price. */
export interface MarketRow {
  asset_start: Buffer;
  asset_end: Buffer;
  price: number;
  high: number;
  low: number;
  direct_volume_over_window: number;
  liquidity: number;
}

export interface Market {
  tickerId: string;
  base: Metadata;
  target: Metadata;
  baseId: string;
  targetId: string;
  /** Row (base, target). */
  forward?: MarketRow;
  /** Row (target, base). */
  reverse?: MarketRow;
}

export interface Ticker {
  ticker_id: string;
  base_currency: string;
  target_currency: string;
  base_symbol: string;
  target_symbol: string;
  pool_id: string;
  last_price: string;
  base_volume: string;
  target_volume: string;
  liquidity_in_usd: string;
  bid?: string;
  ask?: string;
  high?: string;
  low?: string;
}

export interface PairEntry {
  ticker_id: string;
  base: string;
  target: string;
  pool_id: string;
  base_symbol: string;
  target_symbol: string;
}

export const exponentOf = (m: Metadata): number => getDisplayDenomExponent.optional(m) ?? 0;

/** Plain decimal string, 12 significant digits, never exponent notation. */
export const dec = (n: number): string =>
  Number.isFinite(n) ? new BigNumber(n.toPrecision(12)).toFixed() : '0';

/** `passet1…` of a metadata's asset id. */
export const assetIdOf = (m: Metadata): string | undefined =>
  m.penumbraAssetId ? bech32mAssetId(m.penumbraAssetId) : undefined;

export const tickerIdOf = (baseId: string, targetId: string): string => `${baseId}_${targetId}`;

/** Splits a ticker id back into its two asset ids. `passet1…` never contains `_`. */
export const parseTickerId = (tickerId: string): [string, string] | undefined => {
  const parts = tickerId.split('_');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return undefined;
  }
  return [parts[0], parts[1]];
};

export interface OrientRules {
  isStable: (m: Metadata) => boolean;
  stakingHex: string;
}

const hexOf = (m: Metadata): string =>
  m.penumbraAssetId ? Buffer.from(m.penumbraAssetId.inner).toString('hex') : '';

/**
 * Which side is the target. It must never depend on volume or anything else
 * that moves, or a market's ticker_id would change between crawls: a stable
 * is the target, else the staking token, else the smaller asset id is base.
 */
export const orient = (a: Metadata, b: Metadata, rules: OrientRules): [Metadata, Metadata] => {
  const aStable = rules.isStable(a);
  const bStable = rules.isStable(b);
  if (aStable !== bStable) {
    return aStable ? [b, a] : [a, b];
  }
  const aStaking = hexOf(a) === rules.stakingHex;
  const bStaking = hexOf(b) === rules.stakingHex;
  if (aStaking !== bStaking) {
    return aStaking ? [b, a] : [a, b];
  }
  return hexOf(a) < hexOf(b) ? [a, b] : [b, a];
};

/**
 * Group both directions of every pair into one market. Pairs with an asset
 * the registry doesn't know, or with no price, liquidity or volume in
 * either direction, are left out.
 */
export const buildMarkets = (
  rows: MarketRow[],
  lookup: (assetId: Buffer) => Metadata | undefined,
  rules: OrientRules,
): Market[] => {
  const byKey = new Map<string, Market>();
  for (const row of rows) {
    const start = lookup(row.asset_start);
    const end = lookup(row.asset_end);
    if (!start || !end) {
      continue;
    }
    const [base, target] = orient(start, end, rules);
    const baseId = assetIdOf(base);
    const targetId = assetIdOf(target);
    if (!baseId || !targetId || baseId === targetId) {
      continue;
    }
    const tickerId = tickerIdOf(baseId, targetId);
    const market = byKey.get(tickerId) ?? { tickerId, base, target, baseId, targetId };
    if (hexOf(start) === hexOf(base)) {
      market.forward = row;
    } else {
      market.reverse = row;
    }
    byKey.set(tickerId, market);
  }
  // A remembered price alone isn't a market: it needs open liquidity or a
  // trade in the window.
  const active = (r?: MarketRow) => !!r && (r.liquidity > 0 || r.direct_volume_over_window > 0);
  return [...byKey.values()]
    .filter(m => active(m.forward) || active(m.reverse))
    .sort((a, b) => a.tickerId.localeCompare(b.tickerId));
};

/** Target per base in display units, from either direction's raw price. */
export const lastPrice = (m: Market): number => {
  const shift = 10 ** (exponentOf(m.base) - exponentOf(m.target));
  if (m.forward && m.forward.price > 0) {
    return m.forward.price * shift;
  }
  if (m.reverse && m.reverse.price > 0) {
    return shift / m.reverse.price;
  }
  return 0;
};

export const toPair = (m: Market): PairEntry => ({
  ticker_id: m.tickerId,
  base: m.baseId,
  target: m.targetId,
  pool_id: m.tickerId,
  base_symbol: m.base.symbol,
  target_symbol: m.target.symbol,
});

/**
 * Each asset's price in indexing-denom (USDC) base units per base unit, from
 * the same day's rows: directly against the indexing denom where that pair
 * trades, else through the staking token. Keyed by asset id hex.
 */
export const indexingPrices = (
  rows: MarketRow[],
  indexingHex: string,
  stakingHex: string,
): Map<string, number> => {
  const direct = new Map<string, number>();
  const viaStaking = new Map<string, number>();
  for (const r of rows) {
    if (!(r.price > 0)) {
      continue;
    }
    const start = r.asset_start.toString('hex');
    const end = r.asset_end.toString('hex');
    if (end === indexingHex) {
      direct.set(start, r.price);
    } else if (end === stakingHex) {
      viaStaking.set(start, r.price);
    }
  }
  const out = new Map<string, number>([[indexingHex, 1], ...direct]);
  const staking = out.get(stakingHex);
  if (staking !== undefined) {
    for (const [hex, p] of viaStaking) {
      if (!out.has(hex)) {
        out.set(hex, p * staking);
      }
    }
  }
  return out;
};

export interface TickerExtras {
  bid?: number;
  ask?: number;
  /** Asset id hex → indexing-denom base units per base unit. */
  prices?: Map<string, number>;
  /** Display exponent of the indexing denom (USDC), for liquidity in USD. */
  indexingExponent?: number;
}

export const toTicker = (m: Market, extras: TickerExtras = {}): Ticker => {
  const baseExp = exponentOf(m.base);
  const targetExp = exponentOf(m.target);
  // A pair that has never traded has no last price; quote the mid of the
  // book instead when both sides are there.
  const traded = lastPrice(m);
  const mid =
    extras.bid !== undefined && extras.ask !== undefined ? (extras.bid + extras.ask) / 2 : 0;
  const price = traded > 0 ? traded : mid;

  // Each direction's row carries one side's volume. If a direction has no
  // row, its side is converted from the other at the last price.
  let baseVolume = m.forward ? m.forward.direct_volume_over_window / 10 ** baseExp : undefined;
  let targetVolume = m.reverse ? m.reverse.direct_volume_over_window / 10 ** targetExp : undefined;
  if (baseVolume === undefined && targetVolume !== undefined) {
    baseVolume = price > 0 ? targetVolume / price : 0;
  }
  if (targetVolume === undefined && baseVolume !== undefined) {
    targetVolume = baseVolume * price;
  }

  // forward.liquidity is target reserves, reverse.liquidity base reserves,
  // each priced in the indexing denom (an asset with no price counts 0).
  let liquidityUsd = 0;
  if (extras.indexingExponent !== undefined && extras.prices) {
    const targetPrice = extras.prices.get(hexOf(m.target)) ?? 0;
    const basePrice = extras.prices.get(hexOf(m.base)) ?? 0;
    const raw =
      Math.max(m.forward?.liquidity ?? 0, 0) * targetPrice +
      Math.max(m.reverse?.liquidity ?? 0, 0) * basePrice;
    liquidityUsd = raw / 10 ** extras.indexingExponent;
  }

  // pindexer keeps reporting the last high/low after trading stops, so only
  // quote them for a window that actually had volume.
  const shift = 10 ** (baseExp - targetExp);
  const window = (baseVolume ?? 0) > 0 ? m.forward : undefined;
  const high = window && window.high > 0 ? window.high * shift : undefined;
  const low = window && window.low > 0 ? window.low * shift : undefined;

  return {
    ticker_id: m.tickerId,
    base_currency: m.baseId,
    target_currency: m.targetId,
    base_symbol: m.base.symbol,
    target_symbol: m.target.symbol,
    pool_id: m.tickerId,
    last_price: dec(price),
    base_volume: dec(Math.max(baseVolume ?? 0, 0)),
    target_volume: dec(Math.max(targetVolume ?? 0, 0)),
    liquidity_in_usd: dec(liquidityUsd),
    ...(extras.bid !== undefined ? { bid: dec(extras.bid) } : {}),
    ...(extras.ask !== undefined ? { ask: dec(extras.ask) } : {}),
    ...(high !== undefined ? { high: dec(high) } : {}),
    ...(low !== undefined ? { low: dec(low) } : {}),
  };
};

/** A batch-swap trace, as the historical_trades query reads it. */
export interface TraceRow {
  rowid: number;
  input: string;
  output: string;
  time: Date;
}

export interface HistoricalTrade {
  trade_id: number;
  price: string;
  base_volume: string;
  target_volume: string;
  trade_timestamp: string;
  type: 'buy' | 'sell';
}

/**
 * A trace from base to target sold base (a bid was taken: `sell`); one from
 * target to base bought it (an ask was taken: `buy`). The price is worked
 * out from the amounts actually swapped.
 */
export const toTrade = (
  row: TraceRow,
  type: 'buy' | 'sell',
  baseExp: number,
  targetExp: number,
): HistoricalTrade => {
  const [baseRaw, targetRaw] = type === 'sell' ? [row.input, row.output] : [row.output, row.input];
  const base = new BigNumber(baseRaw).shiftedBy(-baseExp);
  const target = new BigNumber(targetRaw).shiftedBy(-targetExp);
  const price = base.isZero() ? 0 : target.div(base).toNumber();
  return {
    trade_id: row.rowid,
    price: dec(price),
    base_volume: base.toFixed(),
    target_volume: target.toFixed(),
    trade_timestamp: String(Math.floor(row.time.getTime() / 1000)),
    type,
  };
};

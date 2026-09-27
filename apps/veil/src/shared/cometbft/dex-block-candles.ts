import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { combineDbCandles, type CandleWithVolume } from '@/shared/api/server/candles/utils';
import type { DbCandle } from '@/shared/api/server/candles/types';

/**
 * Per-block dex candles straight from the chain.
 *
 * pindexer derives its `dex_ex_batch_swap_traces` rows — and therefore every
 * server-side candle — from the ABCI `EventBatchSwap` events in each block.
 * The same events ride along on the CometBFT NewBlock subscription the chart
 * already holds open, so the browser can build the *identical* bar for the
 * block it just received instead of waiting for the indexer to index it and
 * then round-tripping a refetch.
 *
 * One `traces[]` entry is one position's hop path: its first element is the
 * swapped asset/amount and its last element the received one, exactly the
 * `asset_start`/`input` → `asset_end`/`output` columns pindexer stores. A path
 * with no intermediate hop (two elements) is a `direct` swap. Because the rows
 * are reconstructed rather than re-derived, the client bar and the server bar
 * for the same height are produced by the same merge (`combineDbCandles`) from
 * the same numbers.
 */
export interface CometbftDexTrace {
  /** base64 protobuf JSON `AssetId` the swap gave away. */
  startAssetId: string;
  /** base64 protobuf JSON `AssetId` the swap received. */
  endAssetId: string;
  /** Atomic amount given away. */
  input: number;
  /** Atomic amount received. */
  output: number;
  /** No intermediate hop: the two assets of the pair traded with each other. */
  direct: boolean;
}

/** The ABCI event shape we depend on (only the fields we read). */
export interface CometbftAbciEvent {
  type?: string;
  attributes?: { key?: string; value?: string }[];
}

interface TraceEntry {
  amount?: { lo?: string };
  assetId?: { inner?: string };
}

interface SwapExecution {
  traces?: { value?: TraceEntry[] }[];
}

const numberOrZero = (value: string | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Protobuf JSON encodes `bytes` as base64, and the event's trace entries carry
 * the asset ids in exactly that form. Encoding the metadata's raw id bytes the
 * same way makes the two comparable as strings without pulling in a hex helper
 * (and without `AssetId.toJson`, which this protobuf version does not ship).
 *
 * `Metadata` exposes its id as `penumbraAssetId` (there is no `assetId` field
 * on this protobuf version) - reading the wrong name yields `undefined` for
 * every pair, which silently turns every block into "no swap on this pair".
 */
const idKey = (metadata: Metadata | undefined): string | undefined => {
  const inner = metadata?.penumbraAssetId?.inner;
  return inner ? btoa(String.fromCharCode(...inner)) : undefined;
};

const BATCH_SWAP_EVENT = 'EventBatchSwap';
const EXECUTION_KEYS = ['swapExecution1For2', 'swapExecution2For1'];

/**
 * Flatten a block's ABCI events into per-position swap traces.
 *
 * Returns an empty array for blocks with no swaps (the common case), so
 * callers can call this unconditionally on every block.
 */
export const parseDexTraces = (events: CometbftAbciEvent[] | undefined): CometbftDexTrace[] => {
  const traces: CometbftDexTrace[] = [];
  if (!events) {
    return traces;
  }

  for (const event of events) {
    if (!event.type?.endsWith(BATCH_SWAP_EVENT)) {
      continue;
    }
    for (const attribute of event.attributes ?? []) {
      if (!attribute.key || !EXECUTION_KEYS.includes(attribute.key) || !attribute.value) {
        continue;
      }
      let execution: SwapExecution;
      try {
        execution = JSON.parse(attribute.value) as SwapExecution;
      } catch {
        // A malformed attribute costs us this block's bar, never the stream.
        continue;
      }
      for (const trace of execution.traces ?? []) {
        const hop = trace.value;
        if (!hop || hop.length < 2) {
          continue;
        }
        const start = hop[0];
        const end = hop[hop.length - 1];
        if (!start?.assetId?.inner || !end?.assetId?.inner) {
          continue;
        }
        traces.push({
          startAssetId: start.assetId.inner,
          endAssetId: end.assetId.inner,
          input: numberOrZero(start.amount?.lo),
          output: numberOrZero(end.amount?.lo),
          direct: hop.length === 2,
        });
      }
    }
  }

  return traces;
};

/**
 * Accumulate one direction's rows the way the SQL in `blockCandles` does:
 * OHLC from `price_float` (received per given) in row order, `swap_volume`
 * from the received amount, `direct_volume` restricted to unrouted swaps.
 * Rows with a non-positive price are dropped by that same SQL, so they are
 * dropped here too — otherwise the client bar could disagree with the
 * server's for the very same block.
 */
interface DirectionRows {
  prices: number[];
  swapVolume: number;
  directVolume: number;
}

const accumulate = (rows: DirectionRows, trace: CometbftDexTrace, price: number): void => {
  // Mirrors the query's `where price_float > 0` — and nothing else. Adding any
  // further filter here would let the client bar and the server bar for the
  // same block disagree.
  //
  // `Number.isFinite` is the one addition: a hop that gave away nothing makes
  // `output / input` Infinity, which no chart can render. pindexer cannot
  // produce such a row either (its own price arithmetic divides by the same
  // zero), so dropping the hop here can only differ from the server on a row
  // that is unrenderable to begin with.
  if (!Number.isFinite(price) || !(price > 0)) {
    return;
  }
  rows.prices.push(price);
  rows.swapVolume += trace.output;
  if (trace.direct) {
    rows.directVolume += trace.output;
  }
};

const toDbCandle = (rows: DirectionRows, startTime: Date): DbCandle | undefined => {
  const [open] = rows.prices;
  const close = rows.prices.at(-1);
  if (open === undefined || close === undefined) {
    return undefined;
  }
  return {
    open,
    close,
    high: Math.max(...rows.prices),
    low: Math.min(...rows.prices),
    swap_volume: rows.swapVolume,
    direct_volume: rows.directVolume,
    start_time: startTime,
  };
};

/**
 * Build the chart bar for one block, or `undefined` when the block carried no
 * swap between the pair.
 *
 * Prices come out in the same display units as the server candles and the
 * volumes in the same buy/sell/direct split, because this hands the
 * reconstructed rows to the very same `combineDbCandles` the route uses.
 */
export const dexTracesToCandle = (
  traces: readonly CometbftDexTrace[],
  blockTime: string,
  base: Metadata,
  quote: Metadata,
): CandleWithVolume | undefined => {
  const baseId = idKey(base);
  const quoteId = idKey(quote);
  if (!baseId || !quoteId || baseId === quoteId) {
    return undefined;
  }

  // Block headers carry sub-second precision; pindexer stores the block time
  // truncated to seconds, and that stored time is the bar's key on the server
  // path (`row.start_time.getTime() / 1000`). Floor before the merge or the
  // client's bar for a height would land a few hundred milliseconds after the
  // server's for the same height — two bars per block instead of one in-place
  // replacement.
  const startTime = new Date(Math.floor(Date.parse(blockTime) / 1000) * 1000);
  if (Number.isNaN(startTime.getTime())) {
    return undefined;
  }

  const forward: DirectionRows = { prices: [], swapVolume: 0, directVolume: 0 };
  const reverse: DirectionRows = { prices: [], swapVolume: 0, directVolume: 0 };

  for (const trace of traces) {
    if (trace.startAssetId === baseId && trace.endAssetId === quoteId) {
      // Sold the base: quote received per base given.
      accumulate(forward, trace, trace.output / trace.input);
    } else if (trace.startAssetId === quoteId && trace.endAssetId === baseId) {
      // Bought the base. pindexer's `price_float` is *always* asset_end per
      // asset_start (`output / input`), never a pre-inverted quote/base — see
      // BlockCandleRow's contract. So this leg's price is base per quote, and
      // `combineDbCandles` is what turns it back into quote per base.
      accumulate(reverse, trace, trace.output / trace.input);
    }
  }

  const forwardCandle = toDbCandle(forward, startTime);
  const reverseCandle = toDbCandle(reverse, startTime);
  if (!forwardCandle && !reverseCandle) {
    return undefined;
  }

  return combineDbCandles(forwardCandle, reverseCandle, base, quote);
};

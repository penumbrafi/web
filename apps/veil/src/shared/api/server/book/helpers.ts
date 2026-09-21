import { Registry } from '@penumbrafi/registry';
import BigNumber from 'bignumber.js';
import {
  SimulateTradeResponse,
  SwapExecution_Trace,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { ServerTrace, TraceIndex } from '@/shared/api/server/book/types.ts';
import { getAssetIdFromValueView } from '@penumbra-zone/getters/value-view';
import { Value, ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { removeTrailingZeros } from '@penumbra-zone/types/shortify';
import { pnum } from '@penumbra-zone/types/pnum';
import { registryView } from '@/shared/utils/value-view';

// Build an index for this trace based on the price and the hops.
// The index is a concatenation of the price and the asset IDs of each hops.
const computeTraceIndex = (trace: ServerTrace): TraceIndex => {
  const hopsHash = trace.hops.map(h => getAssetIdFromValueView(h).toJsonString()).join('-');
  return `${trace.price}-${hopsHash}`;
};

export const getValueView = (registry: Registry, { amount, assetId }: Value) => {
  const metadata = assetId ? registry.tryGetMetadata(assetId) : undefined;
  return new ValueView({
    valueView: metadata
      ? {
          case: 'knownAssetId',
          value: { amount, metadata },
        }
      : {
          case: 'unknownAssetId',
          value: {
            amount,
            assetId,
          },
        },
  });
};

export const buildTrace = (
  trace: SwapExecution_Trace,
  registry: Registry,
  quote_to_base: boolean,
): ServerTrace => {
  // First, we record the first and last hops.
  const firstHop = trace.value[0];
  const lastHop = trace.value[trace.value.length - 1];

  // Then, we determine which is the base and quote asset.
  // Remember, the sell side is built by simulating from quote to base,
  // and the buy side is built by going from base to quote.
  const baseValue = quote_to_base ? lastHop : firstHop;
  const quoteValue = quote_to_base ? firstHop : lastHop;

  if (!baseValue?.amount || !quoteValue?.amount || !baseValue.assetId || !quoteValue.assetId) {
    throw new Error('Missing required value fields');
  }

  const baseValueView = registryView(registry, baseValue);
  const quoteValueView = registryView(registry, quoteValue);

  // `toFormat(6)` truncates prices under 5e-7 to "0.000000" and loses >2%
  // precision at ~1e-5 (both plausible on low-priced tokens paired with a
  // stable). All zero-formatted rows then merge under the "0-…" trace
  // index and are skipped by `bucketTraces` / `useMarketPrice` — a whole
  // market vanishes for those pairs. Use 6 significant figures instead,
  // so 3.14e-9 stays "0.00000000314" and 1.23456789e-5 keeps meaningful
  // decimals.
  const priceRaw = pnum(quoteValueView)
    .toBigNumber()
    .dividedBy(pnum(baseValueView).toBigNumber());
  const price = priceRaw.isZero() ? '0' : priceRaw.precision(6).toFixed();

  return {
    price: removeTrailingZeros(price),
    amount: pnum(baseValueView).toFormattedString({
      commas: false,
    }),
    total: 'TBD',
    hops: trace.value.map(v => getValueView(registry, v)),
  };
};

export const processSimulation = ({
  res,
  registry,
  limit,
  quote_to_base: quote_to_base = false,
}: {
  res: SimulateTradeResponse;
  registry: Registry;
  limit: number;
  quote_to_base?: boolean;
}): ServerTrace[] => {
  const tracesByPrice = new Map<TraceIndex, ServerTrace>();

  // We consolidate the traces by price and number of hops.
  // This allows us to aggregate the amount available at each price point, while
  // differentiating between single and multi-hop entries in the route book.
  for (const t of res.output?.traces ?? []) {
    const trace = buildTrace(t, registry, quote_to_base);
    // Compute a unique index based on the price and the hops for this trace.
    const index = computeTraceIndex(trace);

    // Check if a previous trace is already stored for this index.
    const storedTrace = tracesByPrice.get(index); /* by reference */
    // If we have a hit, we update the aggregated amount.
    if (storedTrace) {
      const newAmount = new BigNumber(storedTrace.amount).plus(trace.amount);
      storedTrace.amount = newAmount.toString();
    } else {
      // Otherwise, we store the trace.
      tracesByPrice.set(index, trace);
    }
  }

  // Now that we have an aggregated amount for each price point, we sort the traces by price (ascending).
  const sortedTraces = Array.from(tracesByPrice.values()).sort((a, b) => {
    const priceA = new BigNumber(a.price);
    const priceB = new BigNumber(b.price);
    return priceA.comparedTo(priceB) ?? 0;
  });

  // If we are going from quote to base, we want to get the lowest prices first in ascending order.
  // Otherwise, we want to get the highest prices first, ordered in descending order.
  const traces = quote_to_base
    ? sortedTraces.slice(0, limit)
    : sortedTraces.slice(-limit).reverse();

  // `total` is emitted PER-LEVEL (equal to amount) so the client owns the
  // cumulative-vs-per-level toggle. Historically this cumulated on the
  // server AND the client re-cumulated it in `accumulate()` and
  // `bucketTraces()`, producing quadratic totals in the Σ column and an
  // over-weighted depth staircase. Per-level here + accumulate() there is
  // the single source of truth for cumulative.
  const withTotal = traces.map(trace => ({
    ...trace,
    total: removeTrailingZeros(trace.amount),
  }));
  return quote_to_base ? withTotal.reverse() : withTotal;
};

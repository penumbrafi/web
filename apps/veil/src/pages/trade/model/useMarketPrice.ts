import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { bookQueryOptions, useBook } from '../api/book';
import { RouteBookResponse } from '@/shared/api/server/book/types';
import { useRefetchOnNewBlockBatch } from '@/shared/api/compact-block';
import { calculateSpread } from './trace';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';

export interface MarketPriceInfo {
  marketPrice: number | undefined;
  /** Spread as a percentage of mid (e.g. 0.05 means 0.05%). Undefined while
   *  the book is loading. Useful to surface book tightness next to the mid. */
  spreadPercentage: number | undefined;
  /** Highest buy in the book (best bid). */
  bestBid: number | undefined;
  /** Lowest sell in the book (best ask). */
  bestAsk: number | undefined;
  symbols: { base: string; quote: string };
}

export interface DerivedBookPrices {
  marketPrice: number | undefined;
  spreadPercentage: number | undefined;
  bestBid: number | undefined;
  bestAsk: number | undefined;
}

/**
 * Reduces a book to the numbers the UI needs (mid, spread, best bid/ask).
 * Shared by `useMarketPrice` and the per-pair map used on screens without a
 * route pair. Returns undefined until the book resolves.
 */
export const deriveBookPrices = (
  book: RouteBookResponse | undefined,
): DerivedBookPrices | undefined => {
  const multiHops = book?.multiHops;
  if (!multiHops) {
    return undefined;
  }
  const { buy: buyOrders, sell: sellOrders } = multiHops;

  // Calculate spread which includes the midprice
  const spreadInfo = calculateSpread(sellOrders, buyOrders);

  // One-sided book fallback. calculateSpread bails when either side is
  // empty, but the chart / summary / order form need a mid to have a
  // coordinate system to anchor to — otherwise the whole price axis is
  // undefined and the chart renders blank on any pair with only bids or
  // only asks. Use the touch price of the populated side as the mid so
  // the chart, LP-preview overlay and marketPrice-dependent UI all have
  // a real number to work with. Spread is not defined in that case.
  const lastSell = sellOrders[sellOrders.length - 1];
  const firstBuy = buyOrders[0];
  const lowestAsk = lastSell ? parseFloat(lastSell.price) : undefined;
  const highestBid = firstBuy ? parseFloat(firstBuy.price) : undefined;

  // Prefer the two-sided mid; otherwise fall back to the populated side's
  // touch price so the chart always has a price axis to anchor to.
  let marketPrice: number | undefined;
  if (spreadInfo) {
    marketPrice = parseFloat(spreadInfo.midPrice);
  } else if (lowestAsk !== undefined && Number.isFinite(lowestAsk) && lowestAsk > 0) {
    marketPrice = lowestAsk;
  } else if (highestBid !== undefined && Number.isFinite(highestBid) && highestBid > 0) {
    marketPrice = highestBid;
  }

  return {
    marketPrice,
    spreadPercentage: spreadInfo ? parseFloat(spreadInfo.percentage) : undefined,
    bestBid: spreadInfo ? parseFloat(spreadInfo.bestBid) : highestBid,
    bestAsk: spreadInfo ? parseFloat(spreadInfo.bestAsk) : lowestAsk,
  };
};

export const useMarketPrice = (baseSymbol?: string, quoteSymbol?: string): MarketPriceInfo => {
  const pathSymbols = usePathSymbols();
  const base = baseSymbol ?? pathSymbols.baseSymbol;
  const quote = quoteSymbol ?? pathSymbols.quoteSymbol;

  // Memoize so the returned object identity stays stable across renders
  // when base/quote haven't changed — consumers that list the whole
  // `symbols` object as a useEffect dep (e.g. OrderFormStore's marketPrice
  // sync) were re-firing every render because of the fresh literal.
  const symbols = useMemo(() => ({ base, quote }), [base, quote]);

  const { data: book } = useBook(base, quote);
  const derived = deriveBookPrices(book);
  const marketPrice = derived?.marketPrice;
  const spreadPercentage = derived?.spreadPercentage;
  const bestBid = derived?.bestBid;
  const bestAsk = derived?.bestAsk;

  // The book refetches every block and its `data` identity changes each
  // time (even when the ladder is byte-identical), so without this every
  // one of the ~10 consumers (chart, hover tooltip, summary, order form,
  // drawings overlay, ...) re-rendered per block for zero visual change.
  // Key the returned object on the four primitives + the memoized
  // `symbols`, so identity only moves when a number actually moves.
  return useMemo<MarketPriceInfo>(
    () => ({ marketPrice, spreadPercentage, bestBid, bestAsk, symbols }),
    [marketPrice, spreadPercentage, bestBid, bestAsk, symbols],
  );
};

export interface MarketPair {
  base: string;
  quote: string;
}

/**
 * Fetches a book per distinct pair and returns `base|quote` -> mid (quote per
 * base, in display units). Used on screens without a route pair (e.g.
 * /portfolio) where `useMarketPrice`'s route-derived fallback yields nothing.
 * A pair whose book is absent or still loading is omitted, so callers fall
 * back to `Dash` rather than a permanent skeleton.
 */
export const usePortfolioMarketPrices = (pairs: MarketPair[]): Map<string, number> => {
  const queries = useQueries({
    // Depth 1 is the touch (best bid + best ask): all a mid needs. The full
    // 30-level book per LP pair per block was pure payload.
    queries: pairs.map(({ base, quote }) => bookQueryOptions(base, quote, 1)),
  });

  // Same per-key block-tick refetch as `useBook`, so the portfolio mids stay
  // as live as the trade page's. Keyed on the routeBook id shape for parity.
  useRefetchOnNewBlockBatch(
    queries.map((query, index) => ({
      queryKey: ['book', pairs[index]?.base, pairs[index]?.quote, 1],
      refetch: query.refetch,
    })),
    pairs.length === 0,
  );

  const mids = pairs.map((pair, index) => ({
    key: `${pair.base}|${pair.quote}`,
    mid: deriveBookPrices(queries[index]?.data)?.marketPrice,
  }));
  // Serialize the derived mids so the map identity only moves when a number
  // actually moves — book `data` identity changes every block regardless.
  const signature = mids.map(({ key, mid }) => `${key}:${mid ?? ''}`).join(',');

  return useMemo(() => {
    const map = new Map<string, number>();
    for (const { key, mid } of mids) {
      if (mid !== undefined) {
        map.set(key, mid);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized mid signature above; `mids` is a fresh array every render, so listing it would rebuild the map on every parent render
  }, [signature]);
};

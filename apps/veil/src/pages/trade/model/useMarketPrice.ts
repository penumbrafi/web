import { useMemo } from 'react';
import { useBook } from '../api/book';
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
  const multiHops = book?.multiHops;

  // Everything below is derived unconditionally (no early return) so the
  // final `useMemo` can sit after it.
  let marketPrice: number | undefined;
  let spreadPercentage: number | undefined;
  let bestBid: number | undefined;
  let bestAsk: number | undefined;

  if (multiHops) {
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
    const lowestAsk = sellOrders.length
      ? parseFloat(sellOrders[sellOrders.length - 1]!.price)
      : undefined;
    const highestBid = buyOrders.length ? parseFloat(buyOrders[0]!.price) : undefined;

    marketPrice = spreadInfo
      ? parseFloat(spreadInfo.midPrice)
      : lowestAsk !== undefined && Number.isFinite(lowestAsk) && lowestAsk > 0
        ? lowestAsk
        : highestBid !== undefined && Number.isFinite(highestBid) && highestBid > 0
          ? highestBid
          : undefined;
    spreadPercentage = spreadInfo ? parseFloat(spreadInfo.percentage) : undefined;
    bestBid = spreadInfo ? parseFloat(spreadInfo.bestBid) : highestBid;
    bestAsk = spreadInfo ? parseFloat(spreadInfo.bestAsk) : lowestAsk;
  }

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

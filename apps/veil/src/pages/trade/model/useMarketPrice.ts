import { useMemo } from 'react';
import { useBook } from '../api/book';
import { calculateSpread } from './trace';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';

export const useMarketPrice = (
  baseSymbol?: string,
  quoteSymbol?: string,
): {
  marketPrice: number | undefined;
  /** Spread as a percentage of mid (e.g. 0.05 means 0.05%). Undefined while
   *  the book is loading. Useful to surface book tightness next to the mid. */
  spreadPercentage: number | undefined;
  /** Highest buy in the book (best bid). */
  bestBid: number | undefined;
  /** Lowest sell in the book (best ask). */
  bestAsk: number | undefined;
  symbols: { base: string; quote: string };
} => {
  const pathSymbols = usePathSymbols();
  const base = baseSymbol ?? pathSymbols.baseSymbol;
  const quote = quoteSymbol ?? pathSymbols.quoteSymbol;

  // Memoize so the returned object identity stays stable across renders
  // when base/quote haven't changed — consumers that list the whole
  // `symbols` object as a useEffect dep (e.g. OrderFormStore's marketPrice
  // sync) were re-firing every render because of the fresh literal.
  const symbols = useMemo(() => ({ base, quote }), [base, quote]);

  const { data: book } = useBook(base, quote);
  if (!book?.multiHops) {
    return {
      marketPrice: undefined,
      spreadPercentage: undefined,
      bestBid: undefined,
      bestAsk: undefined,
      symbols,
    };
  }

  const { buy: buyOrders, sell: sellOrders } = book.multiHops;

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

  const marketPrice = spreadInfo
    ? parseFloat(spreadInfo.midPrice)
    : lowestAsk !== undefined && Number.isFinite(lowestAsk) && lowestAsk > 0
      ? lowestAsk
      : highestBid !== undefined && Number.isFinite(highestBid) && highestBid > 0
        ? highestBid
        : undefined;
  const spreadPercentage = spreadInfo ? parseFloat(spreadInfo.percentage) : undefined;
  const bestBid = spreadInfo ? parseFloat(spreadInfo.bestBid) : highestBid;
  const bestAsk = spreadInfo ? parseFloat(spreadInfo.bestAsk) : lowestAsk;

  return {
    marketPrice,
    spreadPercentage,
    bestBid,
    bestAsk,
    symbols,
  };
};

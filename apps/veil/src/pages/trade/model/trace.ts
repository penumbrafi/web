import { Trace } from '@/shared/api/server/book/types.ts';
import { round } from '@penumbrafi/types/round';

export const calculateSpread = (sellOrders: Trace[], buyOrders: Trace[]) => {
  if (!sellOrders.length || !buyOrders.length) {
    return;
  }

  const lowestSell = sellOrders[sellOrders.length - 1];
  const highestBuy = buyOrders[0];

  if (lowestSell === undefined || highestBuy === undefined) {
    return;
  }

  const sellPrice = parseFloat(lowestSell.price);
  const buyPrice = parseFloat(highestBuy.price);

  const spread = sellPrice - buyPrice;
  const midPrice = (sellPrice + buyPrice) / 2;
  const spreadPercentage = (spread / midPrice) * 100;

  return {
    amount: round({ value: spread, decimals: 8 }),
    percentage: round({ value: spreadPercentage, decimals: 2 }),
    midPrice: round({ value: midPrice, decimals: 8 }),
    /** Highest buy price — best bid in the book. */
    bestBid: round({ value: buyPrice, decimals: 8 }),
    /** Lowest sell price — best ask. */
    bestAsk: round({ value: sellPrice, decimals: 8 }),
  };
};

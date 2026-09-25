'use client';

import { useEffect, useRef } from 'react';
import { useMarketPrice } from './useMarketPrice';
import { usePathSymbols } from './use-path';
import { TICK_ARROW, type TickDirection } from './use-tick-direction';

const formatPrice = (p: number): string => {
  if (p >= 1) {
    return p.toFixed(4);
  }
  if (p >= 0.01) {
    return p.toFixed(5);
  }
  if (p >= 0.0001) {
    return p.toFixed(6);
  }
  return p.toPrecision(4);
};

/**
 * Stamp the current pair's live mid-price into document.title so a trader
 * with several tabs open can read prices off the tab bar without switching
 * — the small QoL Binance/Coinbase/Hyperliquid have had forever. Prefix
 * with ▲ / ▼ when the tick direction is known so the tab bar surfaces not
 * just where the price is, but which way it just moved.
 *
 * Restores whatever title the page had on mount when the trade route is
 * left, so the user doesn't end up with a stale price string in their tab
 * after navigating away.
 */
export const useLivePriceTitle = () => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();
  const { marketPrice } = useMarketPrice();

  // Capture the title we found when this hook mounted; restore it on
  // unmount so navigating away doesn't leak the price string.
  const initialTitleRef = useRef<string | null>(null);
  useEffect(() => {
    initialTitleRef.current = document.title;
    return () => {
      if (initialTitleRef.current !== null) {
        document.title = initialTitleRef.current;
      }
    };
  }, []);

  // Track the direction of the latest tick via refs — we never want this
  // to cause its own render, just feed the title-update effect.
  const prevPriceRef = useRef<number | undefined>(undefined);
  const directionRef = useRef<TickDirection>('flat');

  useEffect(() => {
    const pair = `${baseSymbol}/${quoteSymbol}`;
    if (marketPrice == null) {
      document.title = `— ${pair} · Veil`;
      return;
    }

    const prev = prevPriceRef.current;
    if (prev !== undefined && prev !== marketPrice) {
      directionRef.current = marketPrice > prev ? 'up' : 'down';
    }
    prevPriceRef.current = marketPrice;

    const arrow = TICK_ARROW[directionRef.current];
    document.title = `${arrow}${formatPrice(marketPrice)} ${pair} · Veil`;
  }, [baseSymbol, quoteSymbol, marketPrice]);

  // Reset direction memory when the pair changes — a 1.23 UM/USDC followed
  // by a 0.0007 OSMO/UM tick isn't a 'down' move, it's a different market.
  useEffect(() => {
    prevPriceRef.current = undefined;
    directionRef.current = 'flat';
  }, [baseSymbol, quoteSymbol]);
};

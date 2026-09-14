'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Per-user toggle state for chart overlays — persisted to localStorage so
 * the trader's preferences ride across sessions, like Binance/TradingView.
 *
 * Keep keys boolean so the storage payload stays parseable even when the
 * shape grows (new overlay types append, existing keys default to true if
 * absent in storage so users opting in once don't lose their chart on
 * release of new overlays).
 */
export interface ChartPrefs {
  depth: boolean;
  midPrice: boolean;
  ownPositions: boolean;
  // wired up in subsequent passes
  ownTrades: boolean;
  openOrders: boolean;
  /**
   * Server-side time-axis gap-fill.
   *  - true  (default): missing window-steps render as flat candles
   *    (open=close=prev.close, vol=0) so candle X-position reflects
   *    actual time elapsed — Binance / TradingView default.
   *  - false: only candles with real fills are sent; a quiet pair
   *    shows its trades adjacent to each other, denser but less
   *    honest about time.
   */
  linearTime: boolean;
  /**
   * Continuous line traced through candle closes. Doji-shaped candles
   * (open ≈ close) collapse to a 1-pixel wick that is easy to miss on
   * a quiet pair, so this line keeps the price visible whether the
   * candles move or not.
   */
  closeLine: boolean;
  /**
   * Line width for own-position lines reflects each position's size
   * relative to the max size of any open own-position on this pair —
   * bigger positions read as thicker lines. Off by default: most traders
   * don't have enough concurrent open positions on one pair for the
   * relative sizing to be worth the extra visual noise.
   */
  linesSizeByAmount: boolean;
  /**
   * Suffix the own-position line's axis label with its amount (base
   * asset for asks/sell, quote asset for bids/buy) — the same figure the
   * LP preview overlay already shows per rung, but on the live lines.
   * Off by default: the plain BUY/SELL label is the quieter option.
   */
  linesShowAmount: boolean;
}

const DEFAULTS: ChartPrefs = {
  // Chart-edge depth heat overlay is OFF by default — the route-book panel
  // beside the chart already shows route depth per-row as red/green bars
  // (MEXC/Binance-style). Users who want the heat shape can opt in via the
  // settings menu.
  depth: false,
  midPrice: true,
  ownPositions: true,
  ownTrades: false,
  openOrders: false,
  linearTime: true,
  closeLine: true,
  linesSizeByAmount: false,
  linesShowAmount: false,
};

const STORAGE_KEY = 'veil_chart_prefs';

const read = (): ChartPrefs => {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChartPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
};

const write = (prefs: ChartPrefs) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
};

export const useChartPrefs = () => {
  // Start at defaults on the server (and during the first client render so
  // hydration matches), then hydrate from localStorage in an effect.
  const [prefs, setPrefs] = useState<ChartPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(read());
  }, []);

  const toggle = useCallback((key: keyof ChartPrefs) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      write(next);
      return next;
    });
  }, []);

  return { prefs, toggle };
};

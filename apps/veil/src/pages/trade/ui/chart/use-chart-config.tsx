import { RefObject, useCallback, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  IPriceLine,
  LineStyle,
  type CreatePriceLineOptions,
  type UTCTimestamp,
} from 'lightweight-charts';
import { theme } from '@penumbra-zone/ui/theme';
import { CandleWithVolume } from '@/shared/api/server/candles/utils';

export interface OwnPositionLine {
  id: string;
  price: number;
  direction: 'buy' | 'sell' | '';
  label?: string;
}

export interface OwnFillMarker {
  /** UNIX seconds — lightweight-charts UTCTimestamp. */
  time: number;
  price: number;
  direction: 'buy' | 'sell';
  /** Hover text (e.g. amount + symbol). */
  label: string;
}

// if `high` / `open` ratio is greater than this value, the chart will limit `high` to `open * RATIO`
const SUPER_CANDLE_RATIO = 3;

// Compute price-axis precision so at least 2 significant digits are visible.
// Examples:
//   price = 1234   → precision 2  ("1234.00")
//   price = 12.3   → precision 2  ("12.30")
//   price = 1.23   → precision 3  ("1.234")
//   price = 0.123  → precision 4  ("0.1234")
//   price = 0.005  → precision 5  ("0.00500")
//   price = 0.0001 → precision 6  ("0.000100")
const priceFormatFor = (price: number): { precision: number; minMove: number } => {
  if (!Number.isFinite(price) || price <= 0) {
    return { precision: 2, minMove: 0.01 };
  }
  const order = Math.floor(Math.log10(price));
  const precision = Math.min(8, Math.max(2, 2 - order));
  const minMove = Math.pow(10, -precision);
  return { precision, minMove };
};

export const useChartConfig = (
  loadMore: () => Promise<void>,
  loadingDisabled: RefObject<boolean>,
) => {
  const chartElRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>(undefined);
  const seriesRef = useRef<ReturnType<IChartApi['addCandlestickSeries']>>(undefined);
  const volumeSeriesRef = useRef<ReturnType<IChartApi['addHistogramSeries']>>(undefined);
  // Overlay line traced through candle closes. Kept in the same price scale
  // as the candles so its Y-axis matches. Toggleable via prefs.closeLine.
  const closeLineSeriesRef = useRef<ReturnType<IChartApi['addLineSeries']>>(undefined);
  const volumeRatioRef = useRef<number>(0.2);
  const ownLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  // chartReady flips true after createChart() runs in setChartRef. Consumers
  // that need to subscribe to chart events list this in their useEffect deps
  // so the effect re-runs once the chart actually exists. Without this the
  // effect runs once at mount when chartRef.current is still null, the
  // subscription short-circuits, and never re-attempts — that's the silent
  // 'drawings tool does nothing' bug.
  const [chartReady, setChartReady] = useState(false);

  const setOwnPositionLines = useCallback((lines: OwnPositionLine[]) => {
    const series = seriesRef.current;
    if (!series) return;

    const seen = new Set<string>();
    for (const line of lines) {
      if (!Number.isFinite(line.price) || line.price <= 0) continue;
      seen.add(line.id);
      // theme.color.text.secondary is '' in @penumbra-zone/ui — falling
      // back to the destructive tint so lightweight-charts never receives
      // an empty color string. Empty color crashes the chart imperative
      // API, which under React 19.2 (Next 16) tears down mid-render and
      // trips a hooks-count divergence (#310) in the mobx observer wrap.
      const color =
        line.direction === 'buy'
          ? theme.color.success.light
          : line.direction === 'sell'
            ? theme.color.destructive.light
            : theme.color.text.secondary || theme.color.text.primary;
      const opts: CreatePriceLineOptions = {
        price: line.price,
        color,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        // Axis label off — lightweight-charts renders a small arrow-like
        // pointer next to the price which reads as a direction indicator
        // and confuses traders. We render our own hover strip via the
        // drag overlay, so the trader hovers the line to see direction +
        // price + amount instead.
        axisLabelVisible: false,
        title: line.label ?? line.id.slice(0, 6),
      };
      const existing = ownLinesRef.current.get(line.id);
      if (existing) {
        existing.applyOptions(opts);
      } else {
        ownLinesRef.current.set(line.id, series.createPriceLine(opts));
      }
    }

    // Remove lines that no longer exist
    for (const [id, lineRef] of ownLinesRef.current.entries()) {
      if (!seen.has(id)) {
        try {
          series.removePriceLine(lineRef);
        } catch {
          // chart may already be torn down
        }
        ownLinesRef.current.delete(id);
      }
    }
  }, []);

  /**
   * Replace the chart's marker overlay with the given fill set. Markers are
   * rendered by lightweight-charts on top of candles (arrow-shaped, anchored
   * by time + price). Empty array clears them.
   */
  const setOwnFillMarkers = useCallback((fills: OwnFillMarker[]) => {
    const series = seriesRef.current;
    if (!series) return;
    if (!fills.length) {
      try {
        series.setMarkers([]);
      } catch {
        // chart torn down
      }
      return;
    }
    // lightweight-charts wants markers sorted by time ascending.
    const markers = [...fills]
      .filter(f => Number.isFinite(f.time) && Number.isFinite(f.price) && f.price > 0)
      .sort((a, b) => a.time - b.time)
      .map(f => ({
        time: f.time as UTCTimestamp,
        position: f.direction === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
        color:
          f.direction === 'buy' ? theme.color.success.light : theme.color.destructive.light,
        // Circles read as "trades happened here" without implying a
        // predicted price direction. Same colour split as before; hover
        // the marker (or the crosshair) to see f.label with the amount.
        shape: 'circle' as const,
        text: f.label,
      }));
    try {
      series.setMarkers(markers);
    } catch {
      // chart torn down
    }
  }, []);

  const setVolumeRatio = useCallback((ratio: number) => {
    const clamped = Math.min(0.6, Math.max(0.05, ratio));
    volumeRatioRef.current = clamped;
    seriesRef.current?.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: clamped },
    });
    volumeSeriesRef.current?.priceScale().applyOptions({
      scaleMargins: { top: 1 - clamped, bottom: 0 },
    });
  }, []);

  // useCallback so the consumer's chart-paint useEffect, which lists
  // setCandlesData / setVolumeData in its deps, doesn't re-fire on every
  // Chart render (Chart re-renders every block via useMarketPrice). The
  // body only reads seriesRef / volumeSeriesRef — both stable refs — so
  // empty deps are honest.
  const setCandlesData = useCallback((candles: CandleWithVolume[] = []) => {
    seriesRef.current?.setData(
      candles.map(candle => ({
        ...candle.ohlc,
        // prevent extreme candle values from breaking the chart
        high:
          candle.ohlc.high / candle.ohlc.open > SUPER_CANDLE_RATIO
            ? candle.ohlc.open * SUPER_CANDLE_RATIO
            : candle.ohlc.high,
      })),
    );

    closeLineSeriesRef.current?.setData(
      candles
        .filter(c => Number.isFinite(c.ohlc.close) && c.ohlc.close > 0)
        .map(c => ({ time: c.ohlc.time, value: c.ohlc.close })),
    );

    // Derive a representative price (median close) so axis labels and the
    // crosshair show 2+ significant digits even for sub-cent prices.
    if (candles.length > 0 && seriesRef.current) {
      const closes = candles
        .map(c => c.ohlc.close)
        .filter(c => Number.isFinite(c) && c > 0)
        .sort((a, b) => a - b);
      const median = closes.length > 0 ? closes[Math.floor(closes.length / 2)] : undefined;
      if (median !== undefined) {
        const { precision, minMove } = priceFormatFor(median);
        seriesRef.current.applyOptions({
          priceFormat: { type: 'price', precision, minMove },
        });
      }
    }
  }, []);

  const setVolumeData = useCallback((candles: CandleWithVolume[] = []) => {
    volumeSeriesRef.current?.setData(
      candles.map(candle => ({
        time: candle.ohlc.time,
        value: candle.volume,
        color:
          candle.ohlc.close >= candle.ohlc.open
            ? theme.color.success.light + '80'
            : theme.color.destructive.light + '80',
      })),
    );
  }, []);

  /**
   * Push the latest few candles into the existing series via series.update()
   * — the lightweight-charts incremental API. Used by the per-block latest-
   * candles refresh so we stop full-replacing 100+ history candles with the
   * 5 latest ones every block (which used to wipe pagination state and
   * trigger a full chart re-layout per tick).
   *
   * series.update() throws when the bar's time is older than the series'
   * current last bar — wrap in try/catch so a stale tick (e.g. arriving
   * after a duration switch but before the new history) doesn't crash the
   * chart, just skips that bar.
   */
  const updateLatestCandles = useCallback((candles: CandleWithVolume[] = []) => {
    const series = seriesRef.current;
    if (!series || !candles.length) return;
    for (const candle of candles) {
      const high =
        candle.ohlc.high / candle.ohlc.open > SUPER_CANDLE_RATIO
          ? candle.ohlc.open * SUPER_CANDLE_RATIO
          : candle.ohlc.high;
      try {
        series.update({ ...candle.ohlc, high });
      } catch {
        // Bar is older than the series' last known time. Safe to skip.
      }
      const line = closeLineSeriesRef.current;
      if (line && Number.isFinite(candle.ohlc.close) && candle.ohlc.close > 0) {
        try {
          line.update({ time: candle.ohlc.time, value: candle.ohlc.close });
        } catch {
          // Stale bar.
        }
      }
    }
  }, []);

  const setCloseLineVisible = useCallback((visible: boolean) => {
    closeLineSeriesRef.current?.applyOptions({ visible });
  }, []);

  const updateLatestVolumes = useCallback((candles: CandleWithVolume[] = []) => {
    const vol = volumeSeriesRef.current;
    if (!vol || !candles.length) return;
    for (const candle of candles) {
      try {
        vol.update({
          time: candle.ohlc.time,
          value: candle.volume,
          color:
            candle.ohlc.close >= candle.ohlc.open
              ? theme.color.success.light + '80'
              : theme.color.destructive.light + '80',
        });
      } catch {
        // Same as updateLatestCandles: skip stale bars.
      }
    }
  }, []);

  const setChartRef = useCallback((node: HTMLDivElement | null) => {
    // unmount when node is null
    if (!node) {
      chartRef.current?.remove();
      chartRef.current = undefined;
      chartElRef.current = null;
      setChartReady(false);
      return;
    }

    // if the element is assigned, create the chart
    if (!chartElRef.current) {
      chartElRef.current = node;

      chartRef.current = createChart(node, {
        autoSize: true,
        layout: {
          textColor: theme.color.text.primary,
          background: {
            color: 'transparent',
          },
          // Hide the lightweight-charts TradingView attribution badge —
          // it links offsite and adds visual noise on a trade page.
          attributionLogo: false,
        },
        grid: {
          vertLines: {
            color: theme.color.other.tonalStroke,
          },
          horzLines: {
            color: theme.color.other.tonalStroke,
          },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });

      // Initialize the candlestick series
      seriesRef.current = chartRef.current.addCandlestickSeries({
        upColor: theme.color.success.light,
        downColor: theme.color.destructive.light,
        borderVisible: false,
        wickUpColor: theme.color.success.light,
        wickDownColor: theme.color.destructive.light,
      });

      // Set the price scale margins for the candlestick series.
      // bottom margin reserves space for the volume pane below.
      seriesRef.current.priceScale().applyOptions({
        autoScale: true,
        // Log scale so the visible domain can never enter negatives —
        // spot prices are strictly > 0, and this is the standard price-
        // chart mode on TradingView / Binance. mode: 1 = Logarithmic in
        // lightweight-charts' PriceScaleMode enum.
        mode: 1,
        scaleMargins: { top: 0.05, bottom: volumeRatioRef.current },
      });

      // Initialize the volume series
      volumeSeriesRef.current = chartRef.current.addHistogramSeries({
        color: theme.color.success.light + '80',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      // Volume occupies the bottom `volumeRatio` of the pane.
      volumeSeriesRef.current.priceScale().applyOptions({
        scaleMargins: {
          top: 1 - volumeRatioRef.current,
          bottom: 0,
        },
      });

      // Close-price line: sits on the candlestick series' price scale, so
      // its Y-axis aligns with the candles. Neutral color at 1px keeps it
      // subtle when candles are moving and legible when they aren't.
      closeLineSeriesRef.current = chartRef.current.addLineSeries({
        // theme.color.text.secondary is '' in the ui package's runtime
        // theme stub (values live in theme.css only), which crashes
        // lightweight-charts with "Cannot parse color:". Fall back to
        // the actual secondary text token used elsewhere.
        color: theme.color.text.secondary || '#a0a0a0',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      // subscribe to users scrolling left and right the price chart
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        // `from=-10` parameter means there needs to be at least 10 empty candles in the left of the chart
        if (!loadingDisabled.current && logicalRange?.from && logicalRange.from < -10) {
          void loadMore();
        }
      });

      // Tell consumer effects that the chart is ready to be subscribed to.
      setChartReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dependent data is called from the function using current data
  }, []);

  // Convert a vertical pixel offset (relative to chart container) to a price
  // on the candle series. Returns undefined if the chart isn't ready or the
  // y is outside the price scale range.
  const priceAtY = useCallback((y: number): number | undefined => {
    const series = seriesRef.current;
    if (!series) return undefined;
    const price = series.coordinateToPrice(y);
    return typeof price === 'number' && Number.isFinite(price) ? price : undefined;
  }, []);

  // Inverse: a price → its current Y coordinate on the candle series.
  // Returns undefined if the chart isn't ready or the price is off-scale.
  const yAtPrice = useCallback((price: number): number | undefined => {
    const series = seriesRef.current;
    if (!series) return undefined;
    const coord = series.priceToCoordinate(price);
    return typeof coord === 'number' && Number.isFinite(coord) ? coord : undefined;
  }, []);

  // Time → x pixel; used by drawings anchored to a (time, price) pair.
  const xAtTime = useCallback((time: number): number | undefined => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const coord = chart.timeScale().timeToCoordinate(time as never);
    return typeof coord === 'number' && Number.isFinite(coord) ? coord : undefined;
  }, []);

  // Reverse: x pixel → time. Useful for placing time-anchored drawings.
  const timeAtX = useCallback((x: number): number | undefined => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const t = chart.timeScale().coordinateToTime(x);
    return typeof t === 'number' && Number.isFinite(t) ? t : undefined;
  }, []);

  /**
   * Anchor the vertical (price) axis so the given `mid` sits at the visible
   * center of the pane. v4.2 IPriceScaleApi doesn't expose setVisibleRange /
   * setPriceRange, so we do this via the series' autoscaleInfoProvider — it
   * returns a fixed { minValue, maxValue } while autoScale is on, and the
   * chart stops consulting it the moment the user drags the price axis
   * (that toggles autoScale off), so user pan/zoom is preserved.
   *
   * We deliberately do NOT refresh this on every block-tick — marketPrice
   * moves each block and yanking the view around would be hostile. The
   * caller in chart.tsx gates on a per-pair ref so this fires exactly once
   * per pair.
   */
  const CENTER_MULTIPLIER = 1.15;
  const centerPriceScaleOn = useCallback((mid: number) => {
    const series = seriesRef.current;
    if (!series) return;
    if (!Number.isFinite(mid) || mid <= 0) return;
    const minValue = mid / CENTER_MULTIPLIER;
    const maxValue = mid * CENTER_MULTIPLIER;
    try {
      series.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue, maxValue },
        }),
      });
      series.priceScale().applyOptions({ autoScale: true });
    } catch {
      // chart torn down
    }
  }, []);

  /**
   * Reset zoom/pan: fit all data on the time axis and re-enable
   * autoscale on the price axis. Mirrors what lightweight-charts'
   * own controls do — but exposed so the right-click menu can offer
   * 'Reset chart view' without the user hunting for the chart's
   * native UI.
   */
  const resetView = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    try {
      chart.timeScale().fitContent();
      series.priceScale().applyOptions({ autoScale: true });
    } catch {
      // chart torn down
    }
  }, []);

  /**
   * Subscribe to native chart clicks. lightweight-charts captures pointer
   * events on its canvas and exposes them via subscribeClick — using DOM
   * onClick on the container does not fire reliably. Caller receives
   * pixel point, price at the click, and the chart time at the click.
   */
  const subscribeChartClick = useCallback(
    (
      cb: (point: { x: number; y: number }, price: number, time: number | undefined) => void,
    ): (() => void) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return () => undefined;

      const handler = (param: { point?: { x: number; y: number }; time?: unknown }) => {
        if (!param.point) return;
        const price = series.coordinateToPrice(param.point.y);
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
        const time = typeof param.time === 'number' ? param.time : undefined;
        cb(param.point, price, time);
      };
      chart.subscribeClick(handler);
      return () => chart.unsubscribeClick(handler);
    },
    [],
  );

  /**
   * Subscribe to crosshair-hover changes. Caller receives the candle
   * (OHLC) and volume at the hovered time, plus pixel position. `null`
   * when crosshair leaves the chart.
   */
  const subscribeHover = useCallback(
    (
      cb: (
        info: {
          time: number;
          candle: { open: number; high: number; low: number; close: number };
          volume: number | undefined;
          point: { x: number; y: number };
        } | null,
      ) => void,
    ): (() => void) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      if (!chart || !series) return () => undefined;

      const handler = (param: {
        time?: unknown;
        seriesData: Map<unknown, unknown>;
        point?: { x: number; y: number };
      }) => {
        if (!param.time || !param.point) {
          cb(null);
          return;
        }
        const candleData = param.seriesData.get(series) as
          | { open: number; high: number; low: number; close: number }
          | undefined;
        if (!candleData) {
          cb(null);
          return;
        }
        const volData = volumeSeries
          ? (param.seriesData.get(volumeSeries) as { value: number } | undefined)
          : undefined;
        cb({
          time: Number(param.time),
          candle: candleData,
          volume: volData?.value,
          point: param.point,
        });
      };

      chart.subscribeCrosshairMove(handler);
      return () => chart.unsubscribeCrosshairMove(handler);
    },
    [],
  );

  /**
   * Subscribe to "the price→y mapping might have changed" events. Used by
   * overlay components (depth bars, position lines) so they redraw only
   * when something visible changes, not every animation frame. Coalesces
   * multiple events per frame via requestAnimationFrame.
   *
   * Returns an unsubscribe function.
   */
  const subscribeRedraw = useCallback((cb: () => void): (() => void) => {
    const chart = chartRef.current;
    const node = chartElRef.current;
    if (!chart || !node) return () => undefined;

    let raf = 0;
    const handler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        cb();
      });
    };

    chart.subscribeCrosshairMove(handler);
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    const ro = new ResizeObserver(handler);
    ro.observe(node);

    // Fire once so the overlay paints on mount.
    handler();

    return () => {
      cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(handler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      ro.disconnect();
    };
  }, []);

  return {
    chartRef: setChartRef,
    setVolumeData,
    setCandlesData,
    updateLatestCandles,
    updateLatestVolumes,
    setVolumeRatio,
    priceAtY,
    yAtPrice,
    xAtTime,
    timeAtX,
    setOwnPositionLines,
    setOwnFillMarkers,
    chartReady,
    resetView,
    centerPriceScaleOn,
    subscribeRedraw,
    subscribeHover,
    subscribeChartClick,
    setCloseLineVisible,
  };
};

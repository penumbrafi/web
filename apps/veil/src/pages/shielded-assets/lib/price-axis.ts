import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { AutoscaleInfo, IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';

// Per wheel pixel; a notch is ~100px, so one notch zooms ~20%.
const WHEEL_ZOOM = 0.002;
const MAX_ZOOM_OUT = 4;

/**
 * Exchange-style value axis for a lightweight-charts chart, always from 0:
 * everything charted here is an amount or a USD value. It starts fitted to
 * the highest value in view. Scrolling over the axis moves the top (zooming
 * towards or away from 0) and pins it, so zooming or panning time leaves it
 * alone, until `reset` (the Auto button, or a double-click on the axis)
 * hands it back.
 *
 * lightweight-charts 4.2 can't set a price range directly, so the range is
 * served through the anchor series' autoscaleInfoProvider (the others step
 * aside) with autoscale left on. Give every series
 * `autoscaleInfoProvider: provider(isAnchor)`, and turn off the chart's own
 * price-axis drag (see createBaseChart), which would bypass the floor.
 */
export const usePriceAxis = (
  chartRef: RefObject<IChartApi | undefined>,
  elRef: RefObject<HTMLDivElement | null>,
  anchor: () => ISeriesApi<SeriesType> | undefined,
  ready: boolean,
) => {
  // The pinned top of the axis, or null to fit what's in view.
  const pinRef = useRef<number | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const [manual, setManual] = useState(false);

  const provider = useCallback(
    (isAnchor: boolean) => (original: () => AutoscaleInfo | null) => {
      if (!isAnchor) {
        return null;
      }
      const fit = original()?.priceRange.maxValue;
      // Zooming out stops at MAX_ZOOM_OUT times the highest value in view.
      const maxValue =
        pinRef.current === null || fit === undefined
          ? fit
          : Math.min(pinRef.current, fit * MAX_ZOOM_OUT);
      return maxValue === undefined || !(maxValue > 0)
        ? null
        : { priceRange: { minValue: 0, maxValue } };
    },
    [],
  );

  const reset = useCallback(() => {
    pinRef.current = null;
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    setManual(false);
  }, [chartRef]);

  useEffect(() => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!ready || !chart || !el) {
      return;
    }
    const overAxis = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      return (
        e.clientX - rect.left >= rect.width - chart.priceScale('right').width() &&
        e.clientY - rect.top <= rect.height - chart.timeScale().height()
      );
    };
    const onWheel = (e: WheelEvent) => {
      const series = anchorRef.current();
      if (!series || !overAxis(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const top = series.coordinateToPrice(0);
      if (top === null || !(top > 0)) {
        return;
      }
      pinRef.current = top * Math.exp(e.deltaY * WHEEL_ZOOM);
      // Re-applying autoScale makes the chart ask the provider again.
      chart.priceScale('right').applyOptions({ autoScale: true });
      setManual(true);
    };
    const onDblClick = (e: MouseEvent) => {
      if (overAxis(e)) {
        reset();
      }
    };
    // Capture, so the chart doesn't also zoom time on the same wheel event.
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    el.addEventListener('dblclick', onDblClick);
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      el.removeEventListener('dblclick', onDblClick);
    };
  }, [chartRef, elRef, ready, reset]);

  return { manual, reset, provider };
};

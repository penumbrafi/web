import { useCallback, useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineStyle,
  LineType,
  MouseEventParams,
  UTCTimestamp,
} from 'lightweight-charts';
import { theme } from '@penumbra-zone/ui/theme';
import type { DepthSeriesData } from './depth-data';

const formatPrice = (p: number): string => {
  if (!Number.isFinite(p)) {
    return '';
  }
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

export interface DepthHover {
  price: number;
  bidValue: number | undefined;
  askValue: number | undefined;
  side: 'bid' | 'ask';
  // Pixel coordinates relative to the chart container; used to position the
  // tooltip overlay.
  x: number;
  y: number;
}

export const useDepthChart = (
  onHover: (hover: DepthHover | null) => void,
  onClick: (price: number, side: 'bid' | 'ask') => void,
) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | undefined>(undefined);
  const bidSeriesRef = useRef<ISeriesApi<'Area'> | undefined>(undefined);
  const askSeriesRef = useRef<ISeriesApi<'Area'> | undefined>(undefined);
  const dataRef = useRef<DepthSeriesData | undefined>(undefined);

  // Stable refs for the latest handlers so we don't have to tear down the
  // chart on every parent re-render.
  const onHoverRef = useRef(onHover);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const setData = useCallback((data: DepthSeriesData | undefined) => {
    dataRef.current = data;
    if (!chartRef.current || !bidSeriesRef.current || !askSeriesRef.current) {
      return;
    }
    if (!data) {
      bidSeriesRef.current.setData([]);
      askSeriesRef.current.setData([]);
      return;
    }
    bidSeriesRef.current.setData(data.bids.map(p => ({ time: p.time, value: p.value })));
    askSeriesRef.current.setData(data.asks.map(p => ({ time: p.time, value: p.value })));
    chartRef.current.timeScale().fitContent();
  }, []);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      chartRef.current?.remove();
      chartRef.current = undefined;
      bidSeriesRef.current = undefined;
      askSeriesRef.current = undefined;
      containerRef.current = null;
      return;
    }
    if (containerRef.current === node) {
      return;
    }
    containerRef.current = node;

    const chart = createChart(node, {
      autoSize: true,
      layout: {
        textColor: theme.color.text.primary,
        background: { color: 'transparent' },
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.color.other.tonalStroke },
        horzLines: { color: theme.color.other.tonalStroke },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { style: LineStyle.Dashed, labelVisible: false },
        horzLine: { style: LineStyle.Dashed },
      },
      rightPriceScale: { borderVisible: false },
      // The container div owns wheel/pinch zoom (see RouteDepth's
      // setWheelZoomRef) and remaps it to the ±% window state. Disable
      // lightweight-charts' own wheel-scale and pinch handling so a single
      // gesture doesn't both re-scale the time axis AND trigger our
      // zoomPct → refetch → fitContent() cycle. Drag-to-pan stays enabled.
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: false,
        pinch: false,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      timeScale: {
        borderVisible: false,
        // The X axis values are scaled prices, not times — format them as
        // numbers via the localization timeFormatter.
        tickMarkFormatter: (time: UTCTimestamp) => {
          const d = dataRef.current;
          if (!d) {
            return '';
          }
          return formatPrice(d.timeToPrice(time as number));
        },
      },
      localization: {
        timeFormatter: (time: UTCTimestamp) => {
          const d = dataRef.current;
          if (!d) {
            return '';
          }
          return formatPrice(d.timeToPrice(time as number));
        },
      },
    });
    chartRef.current = chart;

    const bidSeries = chart.addAreaSeries({
      lineColor: theme.color.success.light,
      topColor: theme.color.success.light + '66',
      bottomColor: theme.color.success.light + '00',
      lineType: LineType.Simple,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    bidSeriesRef.current = bidSeries;

    const askSeries = chart.addAreaSeries({
      lineColor: theme.color.destructive.light,
      topColor: theme.color.destructive.light + '66',
      bottomColor: theme.color.destructive.light + '00',
      lineType: LineType.Simple,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    askSeriesRef.current = askSeries;

    const handleCrosshair = (param: MouseEventParams) => {
      const data = dataRef.current;
      if (!data || !param.point || param.time === undefined) {
        onHoverRef.current(null);
        return;
      }
      const time = param.time as UTCTimestamp;
      const price = data.timeToPrice(time as number);
      const side: 'bid' | 'ask' = (time as number) < (data.midTime as number) ? 'bid' : 'ask';
      const bidEntry = param.seriesData.get(bidSeries);
      const askEntry = param.seriesData.get(askSeries);
      const bidValue =
        bidEntry && 'value' in bidEntry && typeof bidEntry.value === 'number'
          ? bidEntry.value
          : undefined;
      const askValue =
        askEntry && 'value' in askEntry && typeof askEntry.value === 'number'
          ? askEntry.value
          : undefined;
      onHoverRef.current({
        price,
        bidValue,
        askValue,
        side,
        x: param.point.x,
        y: param.point.y,
      });
    };

    const handleClick = (param: MouseEventParams) => {
      const data = dataRef.current;
      if (!data || param.time === undefined) {
        return;
      }
      const time = param.time as UTCTimestamp;
      const price = data.timeToPrice(time as number);
      const side: 'bid' | 'ask' = (time as number) < (data.midTime as number) ? 'bid' : 'ask';
      onClickRef.current(price, side);
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    chart.subscribeClick(handleClick);
  }, []);

  return { containerRef: setContainerRef, setData };
};

export const formatDepthPrice = formatPrice;

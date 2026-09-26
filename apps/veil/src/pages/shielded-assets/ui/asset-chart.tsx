'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IChartApi,
  ISeriesApi,
  LineType,
  MouseEventParams,
  UTCTimestamp,
} from 'lightweight-charts';
import { gridTimes, stepOnGrid } from '../lib/grid';
import { usePriceAxis } from '../lib/price-axis';
import { AutoAxisButton, createBaseChart, RangeKey, SERIES_COLORS, showRange } from './chart-base';
import { formatAmount } from './format';

const precise = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const amountFormat = { type: 'custom' as const, minMove: 1e-8, formatter: formatAmount };

interface Props {
  symbol: string;
  /** The asset's change log, `[timeMs, shielded]`, ascending. */
  points: [number, number][];
  tipMs: number;
  range: RangeKey;
}

/**
 * One asset's shielded balance over time, in its own units, at block
 * resolution (resampled hourly so the time axis stays even). Same zoom and
 * exchange-style price axis as the TVL chart.
 */
export const AssetChart = ({ symbol, points, tipMs, range }: Props) => {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>(undefined);
  const lineRef = useRef<ISeriesApi<'Line'>>(undefined);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ timeMs: number; value: number }>();
  const axis = usePriceAxis(chartRef, elRef, () => lineRef.current, ready);

  useEffect(() => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    const chart = createBaseChart(el);
    chartRef.current = chart;
    const line = chart.addLineSeries({
      color: SERIES_COLORS[0],
      lineWidth: 2,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      crosshairMarkerRadius: 3,
      priceFormat: amountFormat,
      autoscaleInfoProvider: axis.provider(true),
    });
    lineRef.current = line;
    const onMove = (p: MouseEventParams) => {
      const d = p.seriesData.get(line);
      setHover(
        p.time !== undefined && d && 'value' in d
          ? { timeMs: Number(p.time) * 1000, value: d.value }
          : undefined,
      );
    };
    chart.subscribeCrosshairMove(onMove);
    setReady(true);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = undefined;
      lineRef.current = undefined;
      setReady(false);
    };
    // axis.provider is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const line = lineRef.current;
    const first = points[0];
    if (!chart || !line || !first || !tipMs) {
      line?.setData([]);
      return;
    }
    const grid = gridTimes(first[0], tipMs);
    const values = stepOnGrid(points, grid);
    line.setData(
      grid.flatMap((t, i) => {
        const value = values[i];
        return value === undefined ? [] : [{ time: Math.floor(t / 1000) as UTCTimestamp, value }];
      }),
    );
    showRange(chart, range, tipMs);
    // range is applied by its own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [points, tipMs, ready]);

  useEffect(() => {
    if (chartRef.current && ready && points.length > 0) {
      showRange(chartRef.current, range, tipMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a range click
  }, [range]);

  const last = points[points.length - 1];
  const shown = hover ?? (last ? { timeMs: tipMs, value: last[1] } : undefined);

  return (
    <div className='relative h-[240px] sm:h-[300px]'>
      <div ref={elRef} className='absolute inset-0' />
      {shown && (
        <div className='pointer-events-none absolute top-2 left-2 z-10 flex flex-col rounded-sm bg-base-black/75 px-2 py-1 text-xs backdrop-blur-sm'>
          <span className='text-text-secondary'>{dateFmt.format(shown.timeMs)}</span>
          <span className='font-mono text-text-primary'>
            {precise.format(shown.value)} {symbol}
          </span>
        </div>
      )}
      {axis.manual && <AutoAxisButton onClick={axis.reset} />}
    </div>
  );
};

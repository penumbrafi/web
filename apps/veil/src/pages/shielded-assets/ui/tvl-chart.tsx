'use client';

import { useEffect, useRef, useState } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams, UTCTimestamp } from 'lightweight-charts';
import { usePriceAxis } from '../lib/price-axis';
import {
  AutoAxisButton,
  createBaseChart,
  OTHER_COLOR,
  RangeKey,
  SERIES_COLORS,
  showRange,
} from './chart-base';
import { formatUsd } from './format';

export interface Band {
  label: string;
  usd: number[];
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const usdFormat = { type: 'custom' as const, minMove: 0.01, formatter: formatUsd };

interface Props {
  times: number[];
  /** Largest first; drawn bottom-up, with "other" on top. */
  bands: Band[];
  other: number[];
  range: RangeKey;
}

/**
 * Shielded value in USD over time, stacked by asset: the top edge is the
 * total, each band one asset. Wheel or pinch zooms time, drag pans; the
 * price axis is exchange-style (see usePriceAxis).
 */
export const TvlChart = ({ times, bands, other, range }: Props) => {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>(undefined);
  const topRef = useRef<ISeriesApi<'Area'>>(undefined);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number>();
  const axis = usePriceAxis(chartRef, elRef, () => topRef.current, ready);

  useEffect(() => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    const chart = createBaseChart(el);
    chartRef.current = chart;
    setReady(true);
    return () => {
      chart.remove();
      chartRef.current = undefined;
      topRef.current = undefined;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || times.length === 0) {
      return;
    }
    const secs = times.map(t => Math.floor(t / 1000) as UTCTimestamp);
    const index = new Map(secs.map((s, i) => [s, i]));
    // Cumulative sums bottom-up; each area fills down to zero, so drawing
    // the tallest first and the rest over it leaves one band per asset.
    const layers = [
      ...bands.map((b, i) => ({ color: SERIES_COLORS[i] ?? OTHER_COLOR, usd: b.usd })),
      { color: OTHER_COLOR, usd: other },
    ];
    const running = times.map(() => 0);
    const cumulative = layers.map(l => {
      l.usd.forEach((v, i) => {
        running[i] = (running[i] ?? 0) + v;
      });
      return { color: l.color, values: [...running] };
    });
    const series: ISeriesApi<'Area'>[] = [];
    cumulative.reverse().forEach((layer, i) => {
      const s = chart.addAreaSeries({
        lineColor: layer.color,
        topColor: layer.color,
        bottomColor: layer.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: i === 0,
        crosshairMarkerVisible: false,
        priceFormat: usdFormat,
        autoscaleInfoProvider: axis.provider(i === 0),
      });
      s.setData(secs.map((time, j) => ({ time, value: layer.values[j] ?? 0 })));
      series.push(s);
    });
    topRef.current = series[0];
    showRange(chart, range, times[times.length - 1] ?? 0);

    const onMove = (p: MouseEventParams) => {
      setHover(p.time === undefined ? undefined : index.get(p.time as UTCTimestamp));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      topRef.current = undefined;
      // On unmount the mount effect's cleanup has already removed the chart
      // (cleanups run in declaration order), and its series with it.
      if (chartRef.current !== chart) {
        return;
      }
      chart.unsubscribeCrosshairMove(onMove);
      for (const s of series) {
        chart.removeSeries(s);
      }
    };
    // range is applied by its own effect; axis.provider is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [times, bands, other, ready]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart && ready && times.length > 0) {
      showRange(chart, range, times[times.length - 1] ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a range click
  }, [range]);

  const i = hover ?? times.length - 1;
  const rows = [
    ...bands.map((b, k) => ({
      label: b.label,
      color: SERIES_COLORS[k] ?? OTHER_COLOR,
      v: b.usd[i] ?? 0,
    })),
    { label: 'Other', color: OTHER_COLOR, v: other[i] ?? 0 },
  ];
  const total = rows.reduce((s, r) => s + r.v, 0);

  const legend = (
    <>
      <span className='flex justify-between gap-3 text-text-secondary'>
        <span>{dateFmt.format(times[i] ?? 0)}</span>
        <span className='font-mono text-text-primary'>{formatUsd(total)}</span>
      </span>
      {rows.map(r => (
        <span key={r.label} className='flex items-center gap-2'>
          <span
            aria-hidden
            className='size-2 shrink-0 rounded-xs'
            style={{ background: r.color }}
          />
          <span className='truncate text-text-primary'>{r.label}</span>
          <span className='ml-auto pl-3 font-mono text-text-primary'>{formatUsd(r.v)}</span>
        </span>
      ))}
    </>
  );

  return (
    <div className='flex flex-col gap-3'>
      <div className='relative h-[260px] sm:h-[380px]'>
        <div ref={elRef} className='absolute inset-0' />
        {times.length > 0 && (
          <div className='pointer-events-none absolute top-2 left-2 z-10 hidden min-w-44 flex-col gap-0.5 rounded-sm bg-base-black/75 px-2 py-1 text-xs backdrop-blur-sm sm:flex'>
            {legend}
          </div>
        )}
        {axis.manual && <AutoAxisButton onClick={axis.reset} />}
      </div>
      {/* Phones: below the chart, so it doesn't cover half of it. */}
      {times.length > 0 && (
        <div className='grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:hidden [&>span:first-child]:col-span-2'>
          {legend}
        </div>
      )}
    </div>
  );
};

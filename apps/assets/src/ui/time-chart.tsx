'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART } from './chart-theme';
import { formatAmount, formatCompact, formatDateTime, formatTick } from './format';

export interface SeriesSpec {
  key: string;
  name: string;
  color: string;
}

/** One row per timestamp; series values are numbers or null (gap). */
export type Row = { t: number } & Record<string, number | null>;

interface Props {
  rows: Row[];
  series: SeriesSpec[];
  /** Step for the sparse change log, linear for the per-block supply sample. */
  kind: 'step' | 'line';
  log?: boolean;
  /** Formatter for the y axis and tooltip values; defaults to amounts. */
  format?: (v: number) => string;
  formatTickValue?: (v: number) => string;
  height?: number;
}

interface TooltipContent {
  active?: boolean;
  label?: unknown;
  payload?: readonly {
    dataKey?: unknown;
    name?: unknown;
    value?: unknown;
    color?: string;
  }[];
}

const ChartTooltip = ({
  active,
  label,
  payload,
  format,
  series,
}: TooltipContent & { format: (v: number) => string; series: SeriesSpec[] }) => {
  if (!active || !payload?.length || typeof label !== 'number') {
    return null;
  }
  const byKey = new Map(payload.map(p => [String(p.dataKey), p]));
  return (
    <div className='rounded-xs border border-other-tonal-stroke bg-base-black-alt px-3 py-2 text-xs shadow-lg'>
      <div className='mb-1 text-text-secondary'>{formatDateTime(label)}</div>
      {series.map(s => {
        const v = byKey.get(s.key)?.value;
        return (
          <div key={s.key} className='flex items-center gap-2'>
            <span aria-hidden className='inline-block h-0.5 w-3' style={{ background: s.color }} />
            <span className='tnum font-medium text-text-primary'>
              {typeof v === 'number' ? format(v) : '—'}
            </span>
            {series.length > 1 && <span className='text-text-secondary'>{s.name}</span>}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Single-axis time chart. X is numeric unix ms on a time scale, so the
 * irregular spacing of change events is drawn truthfully; a category axis
 * would space them evenly and lie about time. `log` maps to a log y-scale;
 * callers must already have turned zeros into nulls (see `logSafe`).
 */
export const TimeChart = ({
  rows,
  series,
  kind,
  log = false,
  format = formatAmount,
  formatTickValue = formatCompact,
  height = 300,
}: Props) => {
  const span = useMemo(() => {
    const first = rows[0]?.t ?? 0;
    const last = rows[rows.length - 1]?.t ?? 0;
    return last - first;
  }, [rows]);

  return (
    <ResponsiveContainer width='100%' height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey='t'
          type='number'
          scale='time'
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => formatTick(v, span)}
          tick={{ fill: CHART.muted, fontSize: 11 }}
          axisLine={{ stroke: CHART.axis }}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          scale={log ? 'log' : 'linear'}
          domain={log ? ['auto', 'auto'] : [0, 'auto']}
          allowDataOverflow={false}
          tickFormatter={formatTickValue}
          tick={{ fill: CHART.muted, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
          content={props => <ChartTooltip {...props} format={format} series={series} />}
          isAnimationActive={false}
        />
        {series.length > 1 && (
          <Legend
            iconType='plainline'
            wrapperStyle={{ fontSize: 12, color: CHART.inkSecondary, paddingTop: 8 }}
          />
        )}
        {series.map(s => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            type={kind === 'step' ? 'stepAfter' : 'linear'}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

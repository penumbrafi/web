'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AssetsResponse, CompareResponse, SeriesResponse, SupplyResponse } from '@/lib/api';
import { clipStep, forwardFillOnto, indexTo100, logSafe, unionTimeline } from '@/lib/series';
import { AssetsTable } from './assets-table';
import { ChartFrame, ErrorState } from './chart-frame';
import { CHART, SERIES } from './chart-theme';
import { formatAmount, formatCompact, formatDateTime, formatInt } from './format';
import { RANGE_OPTIONS, rangeStart, type Range } from './range';
import { Segmented } from './segmented';
import { TimeChart, type Row } from './time-chart';
import { useJson } from './use-json';

const SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log' },
] as const;

const COMPARE_OPTIONS = [
  { value: 'indexed', label: 'Indexed' },
  { value: 'log', label: 'Log' },
] as const;

const Stat = ({ label, value, title }: { label: string; value: string; title?: string }) => (
  <div
    className='rounded-md border border-other-tonal-stroke bg-neutral-dark px-4 py-3'
    title={title}
  >
    <div className='text-xs text-text-secondary'>{label}</div>
    <div className='text-lg text-text-primary'>{value}</div>
  </div>
);

export const Dashboard = () => {
  const [range, setRange] = useState<Range>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [assetScale, setAssetScale] = useState<'linear' | 'log'>('linear');
  const [compareMode, setCompareMode] = useState<'indexed' | 'log'>('indexed');

  const assets = useJson<AssetsResponse>('/api/assets');
  const supply = useJson<SupplyResponse>('/api/supply');
  const compare = useJson<CompareResponse>('/api/compare');
  const series = useJson<SeriesResponse>(
    selected ? `/api/assets/${encodeURIComponent(selected)}` : null,
  );

  // Default selection: the largest shielded balance.
  useEffect(() => {
    const first = assets.data?.assets[0];
    if (selected === null && first) {
      setSelected(first.id);
    }
  }, [assets.data, selected]);

  const latestMs = assets.data?.latest.timestamp ?? supply.data?.latest.timestamp ?? Date.now();
  const from = rangeStart(range, latestMs);

  const supplyRows = useMemo<Row[]>(
    () => (supply.data?.points ?? []).filter(p => p.t >= from).map(p => ({ t: p.t, supply: p.v })),
    [supply.data, from],
  );

  const assetRows = useMemo<Row[]>(() => {
    if (!series.data) {
      return [];
    }
    const log = assetScale === 'log';
    const clipped = clipStep(series.data.current, from, series.data.latest.timestamp);
    return clipped.map(p => ({ t: p.t, value: log ? logSafe(p.v) : p.v }));
  }, [series.data, from, assetScale]);

  const compareView = useMemo(() => {
    const data = compare.data;
    if (!data) {
      return { rows: [] as Row[], specs: [] };
    }
    const to = data.latest.timestamp;
    const clipped = data.series.map(s => clipStep(s.current, from, to));
    const timeline = unionTimeline(clipped);
    const columns = clipped.map(points => {
      const filled = forwardFillOnto(points, timeline);
      return compareMode === 'log' ? filled.map(logSafe) : indexTo100(filled);
    });
    const rows: Row[] = timeline.map((t, i) => {
      const row: Row = { t };
      data.series.forEach((s, j) => {
        row[s.asset.id] = columns[j]?.[i] ?? null;
      });
      return row;
    });
    const specs = data.series.map((s, j) => ({
      key: s.asset.id,
      name: s.asset.symbol,
      color: SERIES[j] ?? CHART.muted,
    }));
    return { rows, specs };
  }, [compare.data, from, compareMode]);

  const selectedSummary = assets.data?.assets.find(a => a.id === selected);
  const latest = assets.data?.latest;

  let indexedTo: ReactNode;
  if (latest) {
    indexedTo = (
      <>
        Indexed to block <span className='tnum text-text-primary'>{formatInt(latest.height)}</span>{' '}
        at {formatDateTime(latest.timestamp)}
      </>
    );
  } else if (assets.state === 'error') {
    indexedTo = 'Indexer unreachable';
  } else {
    indexedTo = 'Loading…';
  }

  let table: ReactNode;
  if (assets.data) {
    table = <AssetsTable assets={assets.data.assets} selected={selected} onSelect={setSelected} />;
  } else if (assets.state === 'error') {
    table = (
      <div className='rounded-md border border-other-tonal-stroke bg-neutral-dark'>
        <ErrorState error={assets.error} />
      </div>
    );
  } else {
    table = (
      <div className='flex h-32 items-center justify-center rounded-md border border-other-tonal-stroke bg-neutral-dark text-sm text-text-secondary'>
        Loading…
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Segmented label='Time range' value={range} options={RANGE_OPTIONS} onChange={setRange} />
        <div className='text-xs text-text-secondary'>{indexedTo}</div>
      </div>

      <ChartFrame
        title='UM total supply'
        subtitle='One sample every 8,640 blocks (about twelve hours), plus the latest block.'
        loading={supply.state === 'loading'}
        error={supply.state === 'error' ? supply.error : undefined}
        empty={supplyRows.length === 0}
      >
        <TimeChart
          rows={supplyRows}
          series={[{ key: 'supply', name: 'UM total supply', color: SERIES[0] }]}
          kind='line'
          format={formatAmount}
          formatTickValue={formatCompact}
        />
      </ChartFrame>

      <section className='flex flex-col gap-2'>
        <h2 className='text-sm font-medium text-text-primary'>Shielded pool by asset</h2>
        {table}
      </section>

      {assets.data && (
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-3'>
            <label className='text-xs text-text-secondary' htmlFor='asset-select'>
              Asset
            </label>
            <select
              id='asset-select'
              value={selected ?? ''}
              onChange={e => {
                setSelected(e.target.value);
              }}
              className='rounded-xs border border-other-tonal-stroke bg-neutral-dark px-2 py-1 text-sm text-text-primary'
            >
              {assets.data.assets.map(a => (
                <option key={a.id} value={a.id}>
                  {a.symbol}
                </option>
              ))}
            </select>
          </div>

          {selectedSummary && (
            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
              <Stat
                label='Shielded now'
                value={formatAmount(selectedSummary.currentValue)}
                title={`${selectedSummary.currentValueRaw} base units`}
              />
              <Stat
                label='Lifetime inflow'
                value={formatAmount(selectedSummary.totalValue)}
                title={`${selectedSummary.totalValueRaw} base units`}
              />
              <Stat label='Unique depositors' value={formatInt(selectedSummary.uniqueDepositors)} />
              <Stat
                label='Decimals'
                value={String(selectedSummary.exponent)}
                title={selectedSummary.base}
              />
            </div>
          )}

          <ChartFrame
            title={`${selectedSummary?.symbol ?? 'Asset'} shielded balance`}
            subtitle='Step line over the sparse change log: the value holds until the next change event.'
            controls={
              <Segmented
                label='Y scale'
                value={assetScale}
                options={SCALE_OPTIONS}
                onChange={setAssetScale}
              />
            }
            loading={series.state === 'loading'}
            error={series.state === 'error' ? series.error : undefined}
            empty={assetRows.length === 0}
          >
            <TimeChart
              rows={assetRows}
              series={[
                { key: 'value', name: selectedSummary?.symbol ?? 'value', color: SERIES[0] },
              ]}
              kind='step'
              log={assetScale === 'log'}
            />
          </ChartFrame>
        </div>
      )}

      <ChartFrame
        title='Top assets compared'
        subtitle={
          compareMode === 'indexed'
            ? 'The largest balances, each indexed to 100 at the start of the range.'
            : 'The largest balances in display units on a log axis; zero balances are gaps.'
        }
        controls={
          <Segmented
            label='Comparison mode'
            value={compareMode}
            options={COMPARE_OPTIONS}
            onChange={setCompareMode}
          />
        }
        loading={compare.state === 'loading'}
        error={compare.state === 'error' ? compare.error : undefined}
        empty={compareView.rows.length === 0}
      >
        <TimeChart
          rows={compareView.rows}
          series={compareView.specs}
          kind='step'
          log={compareMode === 'log'}
          format={formatAmount}
          formatTickValue={formatCompact}
          height={360}
        />
      </ChartFrame>
    </div>
  );
};

'use client';

import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AssetIcon } from '@penumbra-zone/ui/AssetIcon';
import { base64ToUint8Array } from '@penumbrafi/types/base64';
import { useRegistry } from '@/shared/api/registry';
import type {
  OverviewAsset,
  PoolSnapshot,
  ShieldedOverviewResponse,
  ShieldedSeriesResponse,
} from '@/shared/api/server/shielded-history/types';
import { SegmentedControl, Surface } from '@/pages/inspect/explorer/components';
import { AssetChart } from './asset-chart';
import { RangeKey, RANGES } from './chart-base';
import { formatAmount, formatSigned, formatSignedUsd, formatUsd } from './format';
import { TvlChart } from './tvl-chart';

const WINDOWS = [
  { key: 'd1', label: '24h' },
  { key: 'd7', label: '7d' },
  { key: 'd30', label: '30d' },
] as const;

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: ${res.status}`);
  }
  return (await res.json()) as T;
};

interface Row extends OverviewAsset {
  label: string;
  metadata?: Metadata;
  usd?: number;
}

const labelFor = (a: OverviewAsset, metadata?: Metadata): string => {
  if (metadata?.symbol) {
    return metadata.symbol;
  }
  if (a.symbol !== '') {
    return a.symbol;
  }
  const tail = a.base.split('/').pop();
  return tail !== undefined && tail !== '' ? tail : `${a.assetId.slice(0, 6)}…`;
};

/** Net flow at today's price: how much value moved in or out, not price moves. */
const netFlowUsd = (rows: readonly Row[], key: 'd1' | 'd7' | 'd30') =>
  rows.reduce(
    (sum, r) =>
      r.priceUsd === undefined ? sum : sum + (r.now.current - r[key].current) * r.priceUsd,
    0,
  );

const Delta = ({ now, then, label }: { now: number; then: number; label: string }) => {
  const d = now - then;
  return (
    <span className='whitespace-nowrap'>
      <span
        className={clsx(
          'font-mono',
          d > 0 && 'text-success-light',
          d < 0 && 'text-destructive-light',
          d === 0 && 'text-text-secondary',
        )}
      >
        {d === 0 ? '0' : formatSigned(d)}
      </span>
      <span className='text-text-secondary'> {label}</span>
    </span>
  );
};

/** 24h / 7d / 30d changes; nothing at all when none of them moved. */
const Deltas = ({ row, pick }: { row: Row; pick: (s: PoolSnapshot) => number }) =>
  WINDOWS.every(w => pick(row.now) === pick(row[w.key])) ? null : (
    <div className='flex gap-3 text-xs'>
      {WINDOWS.map(w => (
        <Delta key={w.key} now={pick(row.now)} then={pick(row[w.key])} label={w.label} />
      ))}
    </div>
  );

const MIN_ROW_USD = 1;

/** Worth listing by default: at least a dollar in the pool, or it moved this month. */
const isActive = (r: Row) =>
  (r.usd ?? 0) >= MIN_ROW_USD ||
  r.now.current !== r.d30.current ||
  r.now.total !== r.d30.total ||
  r.now.depositors !== r.d30.depositors;

const MobileLine = ({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) => (
  <span className='flex flex-col gap-0.5 text-sm'>
    <span className='flex justify-between gap-3'>
      <span className='text-text-secondary'>{label}</span>
      <span className='font-mono'>{value}</span>
    </span>
    {children}
  </span>
);

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
    <span className='text-xs text-text-secondary'>{label}</span>
    <span className='font-mono text-lg text-text-primary'>{children}</span>
  </div>
);

const AssetDetail = ({ row, range }: { row: Row; range: RangeKey }) => {
  const series = useQuery({
    queryKey: ['shielded-series', row.assetId],
    queryFn: () =>
      fetchJson<ShieldedSeriesResponse>(
        `/api/shielded-history/series?assets=${encodeURIComponent(row.assetId)}`,
      ),
    staleTime: 60_000,
  });
  const points = useMemo(
    () => (series.data?.series[0]?.points ?? []).map(p => [p[0], p[1]] as [number, number]),
    [series.data],
  );
  if (series.error) {
    return <p className='py-8 text-center text-text-secondary'>Couldn’t load its history.</p>;
  }
  return (
    <div className={clsx('transition-opacity', series.isFetching && 'opacity-60')}>
      <AssetChart
        symbol={row.label}
        points={points}
        tipMs={series.data?.tipMs ?? 0}
        range={range}
      />
    </div>
  );
};

/**
 * The shielded pool at a glance, after penumbers: shielded value over time
 * stacked by asset, then every asset with what sits in the pool, what ever
 * came in, and depositors, each with its 24h / 7d / 30d change. A row opens
 * that asset's own balance chart. USD comes from Penumbra's own DEX only,
 * filtered for liquidity; assets without an honest price show native
 * amounts only.
 */
export const ShieldedAssetsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => search ?? new URLSearchParams(), [search]);
  const registry = useRegistry().data;
  const [showAll, setShowAll] = useState(false);

  const rangeParam = params.get('range');
  const range: RangeKey = RANGES.some(r => r.value === rangeParam)
    ? (rangeParam as RangeKey)
    : 'all';
  const selected = params.get('asset');

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ''), { scroll: false });
    },
    [params, pathname, router],
  );

  const overview = useQuery({
    queryKey: ['shielded-overview'],
    queryFn: () => fetchJson<ShieldedOverviewResponse>('/api/shielded-history/overview'),
    staleTime: 60_000,
  });

  const rows = useMemo<Row[]>(
    () =>
      (overview.data?.assets ?? []).map(a => {
        const metadata = registry.tryGetMetadata(
          new AssetId({ inner: base64ToUint8Array(a.assetId) }),
        );
        return {
          ...a,
          metadata,
          label: labelFor(a, metadata),
          usd: a.priceUsd === undefined ? undefined : a.now.current * a.priceUsd,
        };
      }),
    [overview.data, registry],
  );
  const labelOf = useMemo(() => new Map(rows.map(r => [r.assetId, r.label])), [rows]);
  const bands = useMemo(
    () =>
      (overview.data?.stack ?? []).map(s => ({
        label: labelOf.get(s.assetId) ?? `${s.assetId.slice(0, 6)}…`,
        usd: s.usd,
      })),
    [overview.data, labelOf],
  );

  const active = rows.filter(isActive);
  const shownRows = showAll ? rows : active;
  const tvl = rows.reduce((s, r) => s + (r.usd ?? 0), 0);

  if (overview.error) {
    return (
      <Surface as='section' className='p-4 sm:p-6'>
        <p className='py-24 text-center text-text-secondary'>Couldn’t load shielded-pool data.</p>
      </Surface>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <Surface as='section' className='flex flex-col gap-4 p-4 sm:p-6'>
        <header className='flex flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-medium sm:text-2xl'>Shielded pool</h2>
            <p className='text-sm text-text-secondary'>
              Value of everything shielded over IBC, priced on Penumbra’s own DEX.{' '}
              <span className='hidden sm:inline'>
                Scroll the chart to zoom time, scroll the price axis to zoom value, drag to pan.
              </span>
              <span className='sm:hidden'>Pinch to zoom, drag to pan.</span>
            </p>
          </div>
          <SegmentedControl value={range} onChange={v => setParam('range', v)}>
            {RANGES.map(r => (
              <SegmentedControl.Item key={r.value} value={r.value}>
                {r.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </header>

        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <Stat label='Shielded value'>{overview.data ? formatUsd(tvl) : '…'}</Stat>
          {WINDOWS.map(w => (
            <Stat key={w.key} label={`Net flow ${w.label}`}>
              {overview.data ? formatSignedUsd(netFlowUsd(rows, w.key)) : '…'}
            </Stat>
          ))}
        </div>

        {overview.data ? (
          <TvlChart
            times={overview.data.times}
            bands={bands}
            other={overview.data.otherUsd}
            range={range}
          />
        ) : (
          <div className='h-[380px] animate-pulse rounded-lg bg-other-tonal-fill5' />
        )}
        <p className='text-xs text-text-secondary'>
          Net flow is the change in shielded amounts at today’s prices, so it shows deposits and
          withdrawals, not price moves. Assets without a liquid DEX market are left out of USD
          figures.
        </p>
      </Surface>

      <Surface as='section' className='flex flex-col gap-4 p-4 sm:p-6'>
        <header className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 className='text-xl font-medium sm:text-2xl'>Assets</h2>
          <button
            type='button'
            onClick={() => setShowAll(v => !v)}
            className='text-sm text-text-secondary hover:text-text-primary'
          >
            {showAll ? 'Hide dust and idle assets' : `Show all ${rows.length}`}
          </button>
        </header>
        {/* Phones: one card per asset. */}
        <ul className='flex flex-col sm:hidden'>
          {shownRows.map(r => {
            const open = selected === r.assetId;
            return (
              <li key={r.assetId} className='border-b border-other-tonal-stroke'>
                <button
                  type='button'
                  onClick={() => setParam('asset', open ? null : r.assetId)}
                  className={clsx(
                    'flex w-full flex-col gap-2 py-3 text-left',
                    open && 'bg-other-tonal-fill5',
                  )}
                >
                  <span className='flex items-center gap-2'>
                    <AssetIcon metadata={r.metadata} size='md' />
                    <span className='text-text-primary'>{r.label}</span>
                    <span className='ml-auto font-mono text-sm'>
                      {r.usd === undefined ? '–' : formatUsd(r.usd)}
                    </span>
                  </span>
                  <MobileLine label='Shielded' value={formatAmount(r.now.current)}>
                    <Deltas row={r} pick={s => s.current} />
                  </MobileLine>
                  <MobileLine label='Ever shielded' value={formatAmount(r.now.total)}>
                    <Deltas row={r} pick={s => s.total} />
                  </MobileLine>
                  <MobileLine label='Depositors' value={r.now.depositors.toLocaleString('en-US')}>
                    <Deltas row={r} pick={s => s.depositors} />
                  </MobileLine>
                </button>
                {open && (
                  <div className='pb-3'>
                    <AssetDetail row={r} range={range} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className='hidden overflow-x-auto sm:block'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-other-tonal-stroke text-left text-text-secondary'>
                <th className='pr-4 pb-2 font-medium'>Asset</th>
                <th className='pr-4 pb-2 text-right font-medium'>Value</th>
                <th className='pr-4 pb-2 font-medium'>Shielded now</th>
                <th className='pr-4 pb-2 font-medium'>Ever shielded</th>
                <th className='pb-2 font-medium'>Depositors</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map(r => {
                const open = selected === r.assetId;
                return (
                  <Fragment key={r.assetId}>
                    <tr
                      onClick={() => setParam('asset', open ? null : r.assetId)}
                      className={clsx(
                        'cursor-pointer border-b border-other-tonal-stroke align-top hover:bg-action-hover-overlay',
                        open && 'bg-other-tonal-fill5',
                      )}
                    >
                      <td className='py-3 pr-4'>
                        <span className='flex items-center gap-2'>
                          <AssetIcon metadata={r.metadata} size='md' />
                          <span className='text-text-primary'>{r.label}</span>
                        </span>
                      </td>
                      <td className='py-3 pr-4 text-right font-mono whitespace-nowrap'>
                        {r.usd === undefined ? (
                          <span className='text-text-secondary' title='No liquid DEX market'>
                            –
                          </span>
                        ) : (
                          formatUsd(r.usd)
                        )}
                      </td>
                      <td className='py-3 pr-4'>
                        <div className='flex flex-col gap-1'>
                          <span className='font-mono'>
                            {formatAmount(r.now.current)} {r.label}
                          </span>
                          <Deltas row={r} pick={s => s.current} />
                        </div>
                      </td>
                      <td className='py-3 pr-4'>
                        <div className='flex flex-col gap-1'>
                          <span className='font-mono'>
                            {formatAmount(r.now.total)} {r.label}
                          </span>
                          <Deltas row={r} pick={s => s.total} />
                        </div>
                      </td>
                      <td className='py-3'>
                        <div className='flex flex-col gap-1'>
                          <span className='font-mono'>
                            {r.now.depositors.toLocaleString('en-US')}
                          </span>
                          <Deltas row={r} pick={s => s.depositors} />
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className='border-b border-other-tonal-stroke'>
                        <td colSpan={5} className='py-3'>
                          <AssetDetail row={r} range={range} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
};

'use client';

import { useMemo, useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { sliceByWindow, WindowSelect, type Window, WINDOWS } from './window-select';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SupplyPoint } from '../server/timeseries';
import type { TokenomicsMetrics } from '../server/metrics';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const fmtUM = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg'>
      <div className='text-text-secondary'>{fmtDate(label)}</div>
      {payload.map((p: any) => (
        <div key={p.name} className='mt-1 font-mono' style={{ color: p.color }}>
          {p.name}: {fmtUM(p.value)} UM
        </div>
      ))}
    </div>
  );
};

interface Props {
  metrics: TokenomicsMetrics;
  supply: SupplyPoint[];
}

export const SupplyComposition = ({ metrics, supply }: Props) => {
  const [win, setWin] = useState<Window>('1y');
  const windowDays = useMemo(
    () => WINDOWS.find(w => w.value === win)?.days ?? null,
    [win],
  );

  // Stack layers: bonded + community-pool + liquid = total. We don't have
  // a historical time series for the community pool balance yet (pindexer
  // folds it into `supply_total_unstaked.um`), so this uses the current
  // balance as a constant approximation for every point. It slightly
  // overstates the pool early in the range and understates it recently,
  // but the network gap is small compared to `liquid`, so the shape is
  // still readable. Indexing historical CommunityPoolAssetBalances is a
  // follow-up.
  const communityPoolUM = metrics.communityPoolUM ?? 0;
  const data = useMemo(
    () =>
      sliceByWindow(supply, windowDays).map(p => ({
        date: p.date,
        bonded: p.staked,
        // Clamp so a bad snapshot (staked + pool > total) never makes the
        // liquid band go negative and flip the stack.
        community: Math.min(communityPoolUM, Math.max(0, p.total - p.staked)),
        liquid: Math.max(0, p.total - p.staked - communityPoolUM),
      })),
    [supply, windowDays, communityPoolUM],
  );

  // Free float excludes the protocol-owned community pool balance
  // captured above.
  const free = Math.max(
    0,
    metrics.totalSupply
      - metrics.bondedSupply
      - metrics.dexLocked
      - metrics.auctionLocked
      - communityPoolUM,
  );
  const freePct =
    metrics.totalSupply > 0 ? (free / metrics.totalSupply) * 100 : 0;
  const dexPct =
    metrics.totalSupply > 0 ? (metrics.dexLocked / metrics.totalSupply) * 100 : 0;
  const auctionPct =
    metrics.totalSupply > 0 ? (metrics.auctionLocked / metrics.totalSupply) * 100 : 0;

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          Supply composition
        </Text>
        <Text body color='text.secondary'>
          Where the UM lives. Active bonded is on validators actually in the consensus
          set and earning issuance. Inactive bonded is delegated to validators outside
          that set (may include unbonding-queue tokens) — bonded but not receiving
          issuance. DEX- and auction-locked balances are working liquidity, recoverable.
          The community pool is protocol-owned UM controlled by governance. Free float
          is what&apos;s left — wallets, exchanges, and pending stakes.
        </Text>
      </div>

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-6'>
        {/* Active bonded — the subset of bonded UM that's actually in the
            consensus set and earning staking issuance. Excludes
            jailed/disabled/tombstoned delegations (still bonded but earn
            zero). Kept as the headline "productive" bucket. */}
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Active bonded
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>
              {metrics.activeStakedPct.toFixed(1)}%
            </span>
          </Text>
          <Text small color='text.secondary'>
            {fmtUM(metrics.activeStakedSupply)} UM securing chain
          </Text>
        </div>
        {/* Inactive bonded — delegated UM that earns nothing because the
            validator is out of the active set. Historically we lumped
            this into "Bonded" alongside active, which hid the fact that
            most bonded supply on Penumbra is currently unproductive. */}
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Inactive bonded
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-amber-300'>
              {metrics.inactiveBondedPct.toFixed(1)}%
            </span>
          </Text>
          <Text small color='text.secondary'>
            {fmtUM(metrics.inactiveBondedSupply)} UM outside active set
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            DEX liquidity
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>{dexPct.toFixed(1)}%</span>
          </Text>
          <Text small color='text.secondary'>
            {fmtUM(metrics.dexLocked)} UM
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Auctions
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>{auctionPct.toFixed(2)}%</span>
          </Text>
          <Text small color='text.secondary'>
            {fmtUM(metrics.auctionLocked)} UM
          </Text>
        </div>
        {/* Community pool — protocol-owned UM. Read live from the pd
            node's CommunityPoolAssetBalances RPC because pindexer folds
            it into supply_total_unstaked.um (same bucket as wallets)
            and there is no schema-level way to peel it out. Falls back
            to "—" if the RPC is unreachable; free float then includes
            the pool balance as a known caveat. */}
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Community pool
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-sky-300'>
              {metrics.communityPoolPct === null
                ? '—'
                : `${metrics.communityPoolPct.toFixed(1)}%`}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {metrics.communityPoolUM === null
              ? 'live query unavailable'
              : `${fmtUM(metrics.communityPoolUM)} UM governance-controlled`}
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Free float
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>{freePct.toFixed(1)}%</span>
          </Text>
          <Text small color='text.secondary'>
            {fmtUM(free)} UM
            {metrics.communityPoolUM === null && ' (incl. community pool)'}
          </Text>
        </div>
      </div>

      <div className='rounded-lg bg-other-tonal-fill5 p-4'>
        <div className='mb-2 flex items-center justify-between'>
          <Text detail color='text.secondary'>
            Supply over time
          </Text>
          <WindowSelect value={win} onChange={setWin} />
        </div>
        <ResponsiveContainer height={260} width='100%'>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke='#333' strokeDasharray='3 3' />
            <XAxis
              dataKey='date'
              fontSize={11}
              stroke='#666'
              tickFormatter={fmtDate}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              fontSize={11}
              stroke='#666'
              tickFormatter={v => fmtUM(v)}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#888' }}
              iconType='square'
              align='right'
              verticalAlign='top'
            />
            <Area
              dataKey='bonded'
              name='Bonded'
              stackId='s'
              stroke='#5eead4'
              fill='#5eead4'
              fillOpacity={0.4}
              type='monotone'
            />
            <Area
              dataKey='community'
              name='Community pool'
              stackId='s'
              stroke='#7dd3fc'
              fill='#7dd3fc'
              fillOpacity={0.35}
              type='monotone'
            />
            <Area
              dataKey='liquid'
              name='Liquid'
              stackId='s'
              stroke='#fb923c'
              fill='#fb923c'
              fillOpacity={0.3}
              type='monotone'
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

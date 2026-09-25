'use client';

import { Text } from '@penumbra-zone/ui/Text';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tooltipNumber, type ChartTooltipProps } from './chart-tooltip';
import type { BurnPoint } from '../server/timeseries';
import type { TokenomicsMetrics } from '../server/metrics';

const fmtUM = (n: number) => {
  if (n >= 1_000_000) {return `${(n / 1_000_000).toFixed(2)}M`;}
  if (n >= 1_000) {return `${(n / 1_000).toFixed(1)}K`;}
  if (n >= 1) {return n.toFixed(0);}
  return n.toFixed(2);
};
// Pin locale + tz so SSR and client render the exact same label.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const BurnTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload?.length) {return null;}
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg'>
      <div className='text-text-secondary'>{fmtDate(String(label ?? ''))}</div>
      {payload.map(p => (
        <div key={String(p.name)} className='mt-1 font-mono' style={{ color: p.color }}>
          {p.name}: {fmtUM(tooltipNumber(p.value))} UM
        </div>
      ))}
    </div>
  );
};

interface Props {
  metrics: TokenomicsMetrics;
  burns: BurnPoint[];
}

export const BurnPanel = ({ metrics, burns }: Props) => {
  const arbShare =
    metrics.totalBurned > 0 ? (metrics.arbBurned / metrics.totalBurned) * 100 : 0;
  const feeShare =
    metrics.totalBurned > 0 ? (metrics.feeBurned / metrics.totalBurned) * 100 : 0;

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          Burns: protocol-captured arbitrage
        </Text>
        <Text body color='text.secondary'>
          Two flows permanently remove UM from supply. Validators don&apos;t collect fee
          revenue — they&apos;re paid only by inflation — so on-chain activity is a tax
          on supply, not a tax on users. The arbitrage column is the punchline:
          uniform-price batch clearing means the protocol itself captures any
          mispricing between liquidity positions, instead of letting MEV searchers
          extract it.
        </Text>
      </div>

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Arbitrage burns
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-orange-400'>
              {fmtUM(metrics.arbBurned)} UM
            </span>
          </Text>
          <Text small color='text.secondary'>
            {arbShare.toFixed(1)}% of total
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Fee burns
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>
              {fmtUM(metrics.feeBurned)} UM
            </span>
          </Text>
          <Text small color='text.secondary'>
            {feeShare.toFixed(1)}% of total
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            DEX-locked
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>{fmtUM(metrics.dexLocked)} UM</span>
          </Text>
          <Text small color='text.secondary'>
            recoverable in LPs
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Auction-locked
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>{fmtUM(metrics.auctionLocked)} UM</span>
          </Text>
          <Text small color='text.secondary'>
            in active Dutch auctions
          </Text>
        </div>
      </div>

      <div className='rounded-lg bg-other-tonal-fill5 p-4'>
        <ResponsiveContainer height={260} width='100%'>
          <BarChart data={burns} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              tickFormatter={(v: unknown) => fmtUM(tooltipNumber(v))}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<BurnTooltip />} cursor={{ fill: '#222' }} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#888' }}
              iconType='square'
              align='right'
              verticalAlign='top'
            />
            <Bar dataKey='arb' name='Arbitrage' stackId='b' fill='#fb923c' />
            <Bar dataKey='fees' name='Fees' stackId='b' fill='#5eead4' />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Text small color='text.secondary'>
        Arbitrage burn ≠ fee revenue. When a batch clears, the protocol fills all swaps
        at one uniform price. Any LP that quoted a tighter spread than that uniform
        price gets the difference; UM that&apos;s left over after every fill —
        the &quot;cleanup&quot; from inverting price gaps along multi-hop routes —
        accrues to no one and is burned. The chain pays itself the searcher tip.
      </Text>
    </section>
  );
};

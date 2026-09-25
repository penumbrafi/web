'use client';

import { Text } from '@penumbra-zone/ui/Text';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ValidatorStakeFlowPoint } from '../server/validator-stake-history';

// Pin locale + tz so SSR and client render the exact same label.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const fmtUM = (n: number) => {
  if (n === 0) {return '0';}
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) {return `${sign}${(abs / 1_000_000).toFixed(2)}M`;}
  if (abs >= 1_000) {return `${sign}${(abs / 1_000).toFixed(0)}K`;}
  return `${sign}${abs.toFixed(0)}`;
};

interface RechartsTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

const ChartTooltip = ({ active, payload, label }: RechartsTooltipProps) => {
  if (!active || !payload?.length || !label) {return null;}
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg'>
      <div className='text-text-secondary'>{fmtDate(label)}</div>
      {payload.map(p => (
        <div key={p.name} className='mt-1 font-mono' style={{ color: p.color }}>
          {p.name}: {fmtUM(p.value)} UM
        </div>
      ))}
    </div>
  );
};

interface Props {
  data: ValidatorStakeFlowPoint[];
  days?: number;
}

export const ValidatorStakeHistoryChart = ({ data, days = 90 }: Props) => {
  const chartData = data.map(p => ({
    date: p.date,
    stake: p.stake,
    delegated: p.delegated,
    undelegated: -p.undelegated,
  }));

  const totals = data.reduce(
    (acc, p) => ({
      delegated: acc.delegated + p.delegated,
      undelegated: acc.undelegated + p.undelegated,
    }),
    { delegated: 0, undelegated: 0 },
  );
  const netFlow = totals.delegated - totals.undelegated;
  const latestStake = data.at(-1)?.stake ?? 0;

  if (data.length === 0) {
    return (
      <section className='flex flex-col gap-4 rounded-lg bg-other-tonal-fill5 p-6'>
        <Text variant='h2' color='text.primary'>
          Stake history
        </Text>
        <Text body color='text.secondary'>
          No stake history recorded for this validator in the last {days} days.
        </Text>
      </section>
    );
  }

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          Stake history
        </Text>
        <Text body color='text.secondary'>
          Daily UM staked to this validator over the last {days} days, with
          delegation and undelegation tx flows.
        </Text>
      </div>

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Stake (latest)
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>{fmtUM(latestStake)} UM</span>
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Delegated (window)
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-success-light'>{fmtUM(totals.delegated)} UM</span>
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Undelegated (window)
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-destructive-light'>
              {fmtUM(totals.undelegated)} UM
            </span>
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Net flow
          </Text>
          <Text large color='text.primary'>
            <span
              className={`font-mono ${netFlow >= 0 ? 'text-success-light' : 'text-destructive-light'}`}
            >
              {netFlow >= 0 ? '+' : ''}
              {fmtUM(netFlow)} UM
            </span>
          </Text>
        </div>
      </div>

      <div className='rounded-lg bg-other-tonal-fill5 p-4'>
        <ResponsiveContainer height={300} width='100%'>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              yAxisId='stake'
              fontSize={11}
              stroke='#666'
              tickFormatter={(v: number) => fmtUM(v)}
              tickLine={false}
              width={56}
            />
            <YAxis
              yAxisId='flow'
              orientation='right'
              fontSize={11}
              stroke='#666'
              tickFormatter={(v: number) => fmtUM(v)}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#888' }}
              iconType='square'
              align='right'
              verticalAlign='top'
            />
            <Area
              yAxisId='stake'
              dataKey='stake'
              name='Stake'
              stroke='#5eead4'
              fill='#5eead4'
              fillOpacity={0.25}
              type='monotone'
            />
            <Bar
              yAxisId='flow'
              dataKey='delegated'
              name='Delegated'
              fill='#55d383'
              fillOpacity={0.7}
            />
            <Bar
              yAxisId='flow'
              dataKey='undelegated'
              name='Undelegated'
              fill='#f17878'
              fillOpacity={0.7}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

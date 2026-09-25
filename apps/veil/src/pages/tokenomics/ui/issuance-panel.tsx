'use client';

import { useMemo, useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { sliceByWindow, WindowSelect, WINDOWS, type Window } from './window-select';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { InflationPoint } from '../server/timeseries';
import type { TokenomicsMetrics } from '../server/metrics';
import { tooltipNumber, type ChartTooltipProps } from './chart-tooltip';

const fmtPct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
// Pin locale + tz so SSR and client render the exact same label.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const InflationTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  const p = payload?.[0];
  if (!active || !p) {return null;}
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg'>
      <div className='text-text-secondary'>{fmtDate(String(label ?? ''))}</div>
      <div className='mt-1 font-mono text-orange-400'>
        {fmtPct(tooltipNumber(p.value))} annualized
      </div>
    </div>
  );
};

interface Props {
  metrics: TokenomicsMetrics;
  inflation: InflationPoint[];
}

const fmtM = (um: number) =>
  um >= 1_000_000
    ? `${(um / 1_000_000).toFixed(2)}M UM`
    : `${(um / 1_000).toFixed(0)}K UM`;

export const IssuancePanel = ({ metrics, inflation }: Props) => {
  const [win, setWin] = useState<Window>('1y');
  const windowDays = useMemo(
    () => WINDOWS.find(w => w.value === win)?.days ?? null,
    [win],
  );
  const filteredInflation = useMemo(
    () => sliceByWindow(inflation, windowDays),
    [inflation, windowDays],
  );

  const avg = filteredInflation.length
    ? filteredInflation.reduce((a, p) => a + p.annualizedPct, 0) / filteredInflation.length
    : 0;
  const min = filteredInflation.length
    ? Math.min(...filteredInflation.map(p => p.annualizedPct))
    : 0;
  const max = filteredInflation.length
    ? Math.max(...filteredInflation.map(p => p.annualizedPct))
    : 0;
  // Human label for the range card — matches whatever window the trader
  // picked instead of hard-coding "90-day".
  const rangeLabel = windowDays === null ? 'All-time' : windowDays === 30 ? '30-day' : '1-year';
  const issuedSinceGenesis = Math.max(0, metrics.totalSupply - metrics.genesisAllocation);

  // Penumbra mints a FIXED per-block budget for staking (and a separate
  // fixed per-block budget for the LQT), configured in
  // distributions_params. That budget is split across whatever amount of
  // active stake happens to exist, so:
  //   - Network gross issuance does not scale with participation.
  //   - Per-staker APY moves inversely with active bonded stake.
  //   - There is no "capped at X% at full participation" ceiling — the
  //     chain doesn't work that way.
  //
  // The old copy inferred base_rate = realized / active_fraction, called
  // it inflation, and labelled it a ceiling. That number is actually the
  // staker APY on active bonded stake, minus a tiny burn drag — a real
  // number, but not what it was labelled as. See fetchChainIssuanceParams
  // for the source-of-truth path.
  const havingChainParams = metrics.grossIssuancePct !== null;

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          Fixed issuance, variable yield
        </Text>
        <Text body color='text.secondary'>
          Penumbra mints a fixed number of new UM every block —{' '}
          {metrics.stakingIssuancePerBlockUM !== null && (
            <>
              <span className='font-mono'>
                {(metrics.stakingIssuancePerBlockUM * 1_000_000).toFixed(0)} upenumbra
              </span>{' '}
            </>
          )}
          for staking rewards, split across whichever validators are in the active set.
          Participation doesn&apos;t change the budget: doubling active stake halves the
          per-staker yield rather than doubling the network&apos;s issuance. Staking APY
          shown here is issuance divided by the currently-active bonded stake, before
          each validator&apos;s commission cut.
        </Text>
      </div>

      {havingChainParams && (
        <div className='rounded-lg bg-other-tonal-fill5 p-4'>
          <Text small color='text.secondary'>
            <span className='font-mono text-teal-300'>staking APY</span> ={' '}
            <span className='font-mono'>issuance / active bonded</span>
            {'  →  '}
            <span className='font-mono text-teal-300'>
              {metrics.stakingApyPct === null ? '—' : fmtPct(metrics.stakingApyPct)}
            </span>
            {' = '}
            <span className='font-mono'>
              {metrics.stakingIssuanceAnnualUM === null
                ? '—'
                : fmtM(metrics.stakingIssuanceAnnualUM)}
            </span>
            {' / '}
            <span className='font-mono'>{fmtM(metrics.activeStakedSupply)}</span>
          </Text>
          <Text small color='text.secondary' as='div'>
            <span className='mt-1 block'>
              <span className='font-mono text-orange-400'>gross issuance</span>{' '}
              (staking + LQT) ≈{' '}
              <span className='font-mono text-orange-400'>
                {metrics.grossIssuancePct === null
                  ? '—'
                  : fmtPct(metrics.grossIssuancePct)}
              </span>
              {' of supply/yr'}
              {'  →  '}
              observed 30d net-of-burns{' '}
              <span className='font-mono'>
                {metrics.annualizedInflationPct === null
                  ? '—'
                  : fmtPct(metrics.annualizedInflationPct)}
              </span>
              {' + burns '}
              <span className='font-mono'>
                {metrics.burnAnnualizedPct === null
                  ? '—'
                  : fmtPct(metrics.burnAnnualizedPct)}
              </span>
            </span>
          </Text>
        </div>
      )}

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Staking APY
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>
              {metrics.stakingApyPct === null ? '—' : fmtPct(metrics.stakingApyPct, 1)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            pre-commission, on active bonded
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Staking issuance
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>
              {metrics.stakingIssuancePct === null
                ? '—'
                : fmtPct(metrics.stakingIssuancePct, 2)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {metrics.stakingIssuanceAnnualUM === null
              ? 'fixed budget / block'
              : `${fmtM(metrics.stakingIssuanceAnnualUM)}/yr`}
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            LQT issuance
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>
              {metrics.lqtIssuancePct === null
                ? '—'
                : fmtPct(metrics.lqtIssuancePct, 2)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {metrics.lqtIssuanceAnnualUM === null
              ? '—'
              : metrics.lqtIssuanceAnnualUM > 0 && metrics.lqtEndBlock
                ? `${fmtM(metrics.lqtIssuanceAnnualUM)}/yr, ends block ${metrics.lqtEndBlock.toLocaleString('en-US')}`
                : 'ended'}
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Realized 30d
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-orange-400'>
              {metrics.annualizedInflationPct === null
                ? '—'
                : fmtPct(metrics.annualizedInflationPct)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            net of {metrics.burnAnnualizedPct === null ? '—' : fmtPct(metrics.burnAnnualizedPct, 3)} burns
          </Text>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-3 desktop:grid-cols-2'>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            {rangeLabel} inflation range
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>{fmtPct(min, 2)}</span>
            <span className='mx-2 text-text-secondary'>—</span>
            <span className='font-mono text-orange-400'>{fmtPct(max, 2)}</span>
          </Text>
          <Text small color='text.secondary'>
            avg {fmtPct(avg, 2)} (window realized, net of burns)
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Issued since genesis
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>
              {(issuedSinceGenesis / 1_000_000).toFixed(2)}M UM
            </span>
          </Text>
          <Text small color='text.secondary'>
            from {(metrics.genesisAllocation / 1_000_000).toFixed(1)}M genesis
          </Text>
        </div>
      </div>

      <div className='rounded-lg bg-other-tonal-fill5 p-4'>
        <div className='mb-2 flex items-center justify-between'>
          <Text detail color='text.secondary'>
            Realized inflation (trailing 30d, annualized)
          </Text>
          <WindowSelect value={win} onChange={setWin} />
        </div>
        <ResponsiveContainer height={260} width='100%'>
          <AreaChart data={filteredInflation} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id='infl-grad' x1='0' x2='0' y1='0' y2='1'>
                <stop offset='0%' stopColor='#fb923c' stopOpacity={0.4} />
                <stop offset='100%' stopColor='#fb923c' stopOpacity={0} />
              </linearGradient>
            </defs>
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
              tickFormatter={v => `${v}%`}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<InflationTooltip />} />
            <Area
              dataKey='annualizedPct'
              fill='url(#infl-grad)'
              stroke='#fb923c'
              strokeWidth={1.5}
              type='monotone'
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <Text small color='text.secondary'>
        For comparison: BTC ~0.85%/yr post-2024 halving, ZEC ~4%/yr post-2024 halving,
        ETH net ~0.4%/yr, most Cosmos chains 7–20%, Solana ~5%. Penumbra&apos;s gross
        issuance is a fixed budget (staking + LQT) that stays roughly constant
        regardless of participation. DEX fee burns and MEV arb burns run against
        issuance, so a busy DEX can push realized inflation below zero. As more UM
        becomes actively bonded, the staking APY shown above falls proportionally —
        the network mints the same UM either way, it&apos;s just split more thinly.
      </Text>
    </section>
  );
};

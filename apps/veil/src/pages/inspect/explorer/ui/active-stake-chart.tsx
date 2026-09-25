'use client';

import { Suspense, use } from 'react';
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
import type { ActiveStakeFlowPoint, ValidatorFlow } from '../server/active-stake-history';
import { StakeRangeSelector } from './stake-range-selector';
import type { StakeRangeKey } from './stake-range';

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

const fmtPct = (frac: number, digits = 2) =>
  `${(frac * 100).toFixed(digits)}%`;

interface ChartDatum {
  date: string;
  /** activeStake + inactiveStake — the only stake number that's
   *  historically meaningful, since the active/inactive split has to be
   *  taken from each validator's *current* state. */
  bondedStake: number;
  /** totalSupply - bondedStake, stacked on top of bondedStake so the
   *  visible chart reaches total supply and the teal share reads as
   *  the staking ratio. */
  unstakedSupply: number;
  totalSupply: number;
  /** bondedStake / totalSupply, included so the tooltip can render it. */
  stakingRatio: number;
  delegated: number;
  undelegated: number;
  netFlow: number;
  validatorFlows: ValidatorFlow[];
}

interface RechartsTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string; payload?: ChartDatum }[];
  label?: string;
}

// Truncate long validator names for the tooltip — keeps the breakdown
// readable on narrow viewports without dropping disambiguating chars.
const trimName = (name: string, max = 22): string =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

const ChartTooltip = ({ active, payload, label }: RechartsTooltipProps) => {
  if (!active || !payload?.length || !label) {return null;}
  const datum = payload[0]?.payload;
  const flows = datum?.validatorFlows ?? [];
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg'>
      <div className='text-text-secondary'>{fmtDate(label)}</div>
      {payload.map(p => (
        <div key={p.name} className='mt-1 font-mono' style={{ color: p.color }}>
          {p.name}: {fmtUM(p.value)} UM
        </div>
      ))}
      {datum && datum.totalSupply > 0 && (
        <div className='mt-1 font-mono text-text-secondary'>
          Staking ratio: {fmtPct(datum.stakingRatio)}
        </div>
      )}
      {flows.length > 0 && (
        <div className='mt-2 border-t border-neutral-700 pt-2'>
          <div className='mb-1 text-xs tracking-wide text-text-secondary uppercase'>
            Top movers
          </div>
          {flows.map(f => {
            const net = f.delegated - f.undelegated;
            return (
              <div
                key={f.name}
                className='mt-0.5 flex items-center justify-between gap-3 font-mono text-xs'
              >
                <span className='text-text-primary'>{trimName(f.name)}</span>
                <span
                  className={
                    net >= 0 ? 'text-success-light' : 'text-destructive-light'
                  }
                >
                  {net >= 0 ? '+' : ''}
                  {fmtUM(net)} UM
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface Props {
  data: ActiveStakeFlowPoint[];
  currentRange: StakeRangeKey;
}

/**
 * Historical active stake — sum of UM delegated to currently-active
 * validators at end-of-day — overlaid with daily delegation /
 * undelegation tx flows. Active stake reads as the slow-moving area
 * (what's actually securing the chain), the bars read as the daily
 * pulse of new delegations vs. unbonding starts.
 *
 * Mirror the supply-composition chart on tokenomics in shape and palette
 * so a trader who learned the visual language there reads this one for
 * free.
 */
export const ActiveStakeChart = ({ data, currentRange }: Props) => {
  // Recharts wants a positive 'undelegated' value to draw downward — we
  // flip the sign here so bars below zero render naturally on a shared
  // axis. validatorFlows passes through unchanged for the tooltip.
  const chartData: ChartDatum[] = data.map(p => {
    const bonded = p.activeStake + p.inactiveStake;
    const unstaked = Math.max(0, p.totalSupply - bonded);
    const ratio = p.totalSupply > 0 ? bonded / p.totalSupply : 0;
    return {
      date: p.date,
      bondedStake: bonded,
      unstakedSupply: unstaked,
      totalSupply: p.totalSupply,
      stakingRatio: ratio,
      delegated: p.delegated,
      undelegated: -p.undelegated,
      netFlow: p.netFlow,
      validatorFlows: p.validatorFlows,
    };
  });

  const totals = data.reduce(
    (acc, p) => ({
      delegated: acc.delegated + p.delegated,
      undelegated: acc.undelegated + p.undelegated,
    }),
    { delegated: 0, undelegated: 0 },
  );
  const netFlow = totals.delegated - totals.undelegated;
  const latest = data.at(-1);
  const first = data.at(0);
  const latestActive = latest?.activeStake ?? 0;
  const latestInactive = latest?.inactiveStake ?? 0;
  const latestBonded = latestActive + latestInactive;
  const latestSupply = latest?.totalSupply ?? 0;
  const stakingRatio = latestSupply > 0 ? latestBonded / latestSupply : 0;

  // Annualised supply growth from the first to the last visible day —
  // i.e. realised UM-token inflation over the selected window, rescaled
  // to a yearly rate. Falls back to 0 when we don't have both endpoints.
  const supplyStart = first?.totalSupply ?? 0;
  const supplyEnd = latestSupply;
  const windowDays = Math.max(data.length - 1, 1);
  const annualizedInflation =
    supplyStart > 0 && supplyEnd > supplyStart
      ? Math.pow(supplyEnd / supplyStart, 365 / windowDays) - 1
      : 0;
  // If every newly-issued UM flowed to stakers, staking APR ≈
  // inflation / staking_ratio. This is the upper-bound back-of-envelope
  // estimate; real yield is lower (slashing, commission, non-staker
  // issuance like LQT rewards), so we label it "implied".
  const impliedApr = stakingRatio > 0 ? annualizedInflation / stakingRatio : 0;

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <Text variant='h2' color='text.primary'>
            Bonded stake history
          </Text>
          <StakeRangeSelector current={currentRange} />
        </div>
        <Text body color='text.secondary'>
          The teal area is total UM bonded to all validators at end-of-day
          (active + jailed / disabled / not-yet-promoted). The lighter band
          above is the rest of the UM supply, so the chart top reads as
          total supply and the teal share reads as the staking ratio.
          Bars are daily delegation (positive) and undelegation (negative)
          tx flows. Active vs inactive is shown for the latest point only —
          the indexer doesn&apos;t track per-height validator state, so
          historically the chart can&apos;t honestly split the teal band.
        </Text>
      </div>

      <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Bonded stake (latest)
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-teal-300'>
              {fmtUM(latestBonded)} UM
            </span>
          </Text>
          {(latestActive > 0 || latestInactive > 0) && (
            <Text detail color='text.secondary'>
              <span className='font-mono text-teal-300'>{fmtUM(latestActive)}</span>
              {' active · '}
              <span className='font-mono text-amber-300'>{fmtUM(latestInactive)}</span>
              {' inactive'}
            </Text>
          )}
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Total UM supply
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-text-primary'>{fmtUM(latestSupply)} UM</span>
          </Text>
          {latestSupply > 0 && (
            <Text detail color='text.secondary'>
              <span className='font-mono text-teal-300'>{fmtPct(stakingRatio)}</span>
              {' staking ratio'}
            </Text>
          )}
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Realised inflation (annualised)
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono text-amber-300'>
              {annualizedInflation > 0 ? fmtPct(annualizedInflation) : '—'}
            </span>
          </Text>
          {impliedApr > 0 && (
            <Text detail color='text.secondary'>
              <span className='font-mono text-teal-300'>~{fmtPct(impliedApr)}</span>
              {' implied staking APR'}
            </Text>
          )}
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Net flow (window)
          </Text>
          <Text large color='text.primary'>
            <span
              className={`font-mono ${netFlow >= 0 ? 'text-success-light' : 'text-destructive-light'}`}
            >
              {netFlow >= 0 ? '+' : ''}
              {fmtUM(netFlow)} UM
            </span>
          </Text>
          <Text detail color='text.secondary'>
            <span className='font-mono text-success-light'>+{fmtUM(totals.delegated)}</span>
            {' / '}
            <span className='font-mono text-destructive-light'>-{fmtUM(totals.undelegated)}</span>
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
              dataKey='bondedStake'
              name='Bonded stake'
              stroke='#5eead4'
              fill='#5eead4'
              fillOpacity={0.25}
              type='monotone'
              stackId='supply'
            />
            <Area
              yAxisId='stake'
              dataKey='unstakedSupply'
              name='Unstaked supply'
              stroke='#525252'
              fill='#525252'
              fillOpacity={0.12}
              type='monotone'
              stackId='supply'
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

interface ProgressiveProps {
  /** Cheap coarse-resolution data, server-fetched and resolved on first paint. */
  coarseData: ActiveStakeFlowPoint[];
  /** Higher-resolution refinement, streamed in via Suspense. When this Promise
   *  resolves the chart re-renders with the denser series in place. */
  densePromise: Promise<ActiveStakeFlowPoint[]>;
  currentRange: StakeRangeKey;
}

const ResolvedDenseChart = ({
  promise,
  currentRange,
}: {
  promise: Promise<ActiveStakeFlowPoint[]>;
  currentRange: StakeRangeKey;
}) => {
  // React.use() suspends this subtree until the dense data arrives.
  // The outer Suspense fallback keeps the coarse chart on screen meanwhile,
  // so the user sees something useful within ~100ms and a smoother refinement
  // a few seconds later (worst case, 2y cold).
  const data = use(promise);
  return <ActiveStakeChart data={data} currentRange={currentRange} />;
};

/**
 * Progressive-refinement wrapper. Pattern:
 *
 *   1. Server awaits a coarse query (fast, even for 2y), passes the result.
 *   2. Server kicks off a dense query as a *pending* Promise and passes it
 *      across the RSC boundary; React.use() consumes it on the client.
 *   3. Suspense renders the coarse chart while the dense Promise is pending.
 *   4. When the Promise resolves, the dense chart replaces it in place.
 *
 * Net effect: visible chart in ~100ms regardless of window size, with the
 * resolution sharpening up shortly after.
 */
export const ProgressiveActiveStakeChart = ({
  coarseData,
  densePromise,
  currentRange,
}: ProgressiveProps) => (
  <Suspense
    fallback={<ActiveStakeChart data={coarseData} currentRange={currentRange} />}
  >
    <ResolvedDenseChart promise={densePromise} currentRange={currentRange} />
  </Suspense>
);

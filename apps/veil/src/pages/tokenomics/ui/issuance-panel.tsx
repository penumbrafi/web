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
import { tooltipNumber, type ChartTooltipProps } from '@/shared/ui/chart-tooltip.ts';

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
  if (!active || !p) {
    return null;
  }
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
  um >= 1_000_000 ? `${(um / 1_000_000).toFixed(2)}M UM` : `${(um / 1_000).toFixed(0)}K UM`;

const lqtIncentiveText = (metrics: TokenomicsMetrics): string => {
  if (metrics.lqtIncentiveAnnualUM === null) {
    return '—';
  }
  if (metrics.lqtIncentiveAnnualUM > 0 && metrics.lqtEndBlock) {
    return `${fmtM(metrics.lqtIncentiveAnnualUM)}/yr from the pool, ends block ${metrics.lqtEndBlock.toLocaleString('en-US')}`;
  }
  return 'ended';
};

export const IssuancePanel = ({ metrics, inflation }: Props) => {
  const [win, setWin] = useState<Window>('1y');
  const windowDays = useMemo(() => WINDOWS.find(w => w.value === win)?.days ?? null, [win]);
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
  let rangeLabel = '1-year';
  if (windowDays === null) {
    rangeLabel = 'All-time';
  } else if (windowDays === 30) {
    rangeLabel = '30-day';
  }
  const issuedSinceGenesis = Math.max(0, metrics.totalSupply - metrics.genesisAllocation);
  // Yield figures quoted in the prose below come from the same metrics the
  // cards render, so the two can never drift apart.
  const apyText = metrics.stakingApyPct === null ? '—' : fmtPct(metrics.stakingApyPct, 1);
  // Realized (net of commission) numbers, straight off the chain's
  // per-validator rate data. Null when the stake endpoint is unreachable, in
  // which case the prose below skips the commission story entirely.
  const netApyText = metrics.delegatorApyPct === null ? '—' : fmtPct(metrics.delegatorApyPct, 2);
  const bestNetApyText =
    metrics.maxDelegatorApyPct === null ? '—' : fmtPct(metrics.maxDelegatorApyPct, 2);
  const commissionShareText =
    metrics.commissionShareOfIssuancePct === null
      ? '—'
      : fmtPct(metrics.commissionShareOfIssuancePct, 0);
  const bondedYieldText =
    metrics.bondedStakingYieldPct === null ? '—' : fmtPct(metrics.bondedStakingYieldPct, 1);
  const mintText =
    metrics.stakingIssuancePct === null ? '—' : fmtPct(metrics.stakingIssuancePct, 1);
  const worstNetApyText =
    metrics.minDelegatorApyPct === null ? '—' : fmtPct(metrics.minDelegatorApyPct, 2);
  // Annualization input, shown so the APY is auditable: the per-block budget
  // is minted at today's cadence, not at some nominal 5s.
  const cadenceText =
    metrics.blockTimeSeconds === null
      ? null
      : `${metrics.blockTimeSeconds.toFixed(2)}s/block (${(
          (metrics.blocksPerYearEmpirical ?? 0) / 1_000_000
        ).toFixed(2)}M blocks/yr)`;

  // Penumbra mints a FIXED per-block budget for staking, configured in
  // distributions_params. That budget is split across whatever stake is in
  // the ACTIVE validator set (jailed/disabled/tombstoned validators mint
  // nothing), so:
  //   - Minted supply does not scale with participation.
  //   - Per-staker APY moves inversely with ACTIVE bonded stake, and is
  //     always higher than the same budget spread over all bonded UM.
  //   - There is no "capped at X% at full participation" ceiling — the
  //     chain doesn't work that way.
  //
  // The LQT budget is a different thing entirely: it is paid out of the
  // community pool, not minted, so it belongs nowhere near an "issuance %"
  // line. See fetchChainIssuanceParams for the source-of-truth path.
  const havingChainParams = metrics.stakingIssuancePct !== null;

  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          Fixed issuance, selected payout
        </Text>
        <Text body color='text.secondary'>
          Penumbra mints a fixed{' '}
          {metrics.stakingIssuancePerBlockUM !== null && (
            <>
              <span className='font-mono'>
                {(metrics.stakingIssuancePerBlockUM * 1_000_000).toFixed(0)} upenumbra
              </span>{' '}
            </>
          )}
          every block for staking rewards, and nothing else. The budget never scales with
          participation — it is split across the stake that is in the <em>active</em> validator set,
          and validators that are jailed, disabled or tombstoned mint nothing at all. Today that set
          is {metrics.activeValidatorCount} validators holding{' '}
          <span className='font-mono'>{fmtM(metrics.activeStakedSupply)}</span> of the{' '}
          <span className='font-mono'>{fmtM(metrics.bondedSupply)}</span> bonded to validators, so
          the same budget is worth {apyText} before commission and {bondedYieldText} if it were
          spread over every bonded UM.{' '}
          {metrics.delegatorApyPct !== null && (
            <>
              Commission comes off the top before a delegator sees anything: the chain&apos;s own
              per-validator rate data puts the best active validator at {bestNetApyText} net and the
              power-weighted average at {netApyText}, because {commissionShareText} of the budget is
              paid out as validator commission
              {metrics.largestValidatorPowerPct !== null &&
                metrics.largestValidatorCommissionBps !== null && (
                  <>
                    {' '}
                    (the largest active validator holds{' '}
                    <span className='font-mono'>
                      {fmtPct(metrics.largestValidatorPowerPct, 1)}
                    </span>{' '}
                    of the active stake at a{' '}
                    <span className='font-mono'>
                      {fmtPct(metrics.largestValidatorCommissionBps / 100, 0)}
                    </span>{' '}
                    commission)
                  </>
                )}
              .
            </>
          )}{' '}
          The liquidity tournament is a separate flow: it is paid out of the community pool, not
          minted.
        </Text>
      </div>

      {havingChainParams && (
        <div className='rounded-lg bg-other-tonal-fill5 p-4'>
          <Text small color='text.secondary'>
            <span className='font-mono text-teal-300'>staking APY</span> ={' '}
            <span className='font-mono'>issuance per block × blocks per year / active bonded</span>
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
            /yr / <span className='font-mono'>{fmtM(metrics.activeStakedSupply)}</span>
            {cadenceText !== null && <> at {cadenceText}</>}
          </Text>
          <Text small color='text.secondary' as='div'>
            <span className='mt-1 block'>
              The budget is what is capped, not the rate. The chain pays at most{' '}
              <span className='font-mono'>
                {metrics.stakingIssuanceAnnualUM === null
                  ? '—'
                  : fmtM(metrics.stakingIssuanceAnnualUM)}
              </span>{' '}
              per year in total (an epoch whose rewards would exceed the accumulated budget is
              rejected, so payout cannot exceed the budget), but the per-epoch rate is that budget{' '}
              <em>divided by the active stake</em>: with less stake active, the same UM is shared
              among fewer bonded UM and the per-unit APY rises. There is no participation ceiling at
              which the chain stops paying — nor a &quot;max ~2%&quot;: at today&apos;s cadence the
              full budget buys {apyText} on the active set.
            </span>
          </Text>
          <Text small color='text.secondary' as='div'>
            <span className='mt-1 block'>
              <span className='font-mono text-teal-300'>same budget, all bonded</span> ={' '}
              <span className='font-mono'>
                {metrics.bondedStakingYieldPct === null
                  ? '—'
                  : fmtPct(metrics.bondedStakingYieldPct)}
              </span>
              {' — '}
              <span className='font-mono'>{fmtM(metrics.inactiveBondedSupply)}</span> is bonded to
              inactive validators and earns none of it, so this is the average across the whole
              bonded pile, not a rate anyone is paid.
            </span>
          </Text>
          {metrics.delegatorApyPct !== null && (
            <Text small color='text.secondary' as='div'>
              <span className='mt-1 block'>
                <span className='font-mono text-teal-300'>delegator APY</span> ={' '}
                <span className='font-mono'>staking APY × (1 − commission)</span>
                {'  →  '}
                <span className='font-mono text-teal-300'>{netApyText}</span>
                {' power-weighted, '}
                <span className='font-mono text-teal-300'>{bestNetApyText}</span> best,{' '}
                <span className='font-mono text-teal-300'>{worstNetApyText}</span> worst — each
                validator&apos;s own reward rate from the chain, net of its commission streams. Even
                the lowest-rate active validator beats the all-bonded average, which only counts
                stake that is not earning.
              </span>
            </Text>
          )}
          <Text small color='text.secondary' as='div'>
            <span className='mt-1 block'>
              <span className='font-mono text-orange-400'>minted supply</span> (staking only) ≈{' '}
              <span className='font-mono text-orange-400'>
                {metrics.stakingIssuancePct === null ? '—' : fmtPct(metrics.stakingIssuancePct)}
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
                {metrics.burnAnnualizedPct === null ? '—' : fmtPct(metrics.burnAnnualizedPct)}
              </span>
            </span>
          </Text>
          <Text small color='text.secondary' as='div'>
            <span className='mt-1 block'>
              <span className='font-mono text-orange-400'>LQT</span> pays{' '}
              <span className='font-mono'>
                {metrics.lqtIncentiveAnnualUM === null ? '—' : fmtM(metrics.lqtIncentiveAnnualUM)}
              </span>
              /yr out of the community pool
              {metrics.communityPoolUM === null
                ? ''
                : ` (${fmtM(metrics.communityPoolUM)} balance)`}
              {' — a transfer, so it never shows up as supply growth.'}
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
              {metrics.delegatorApyPct === null
                ? metrics.stakingApyPct === null
                  ? '—'
                  : fmtPct(metrics.stakingApyPct, 1)
                : fmtPct(metrics.delegatorApyPct, 1)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {metrics.delegatorApyPct === null
              ? 'gross, pre-commission, active validators only — chain stake data unreachable'
              : `net of commission, power-weighted across the active set — gross before commission ${apyText}, best active ${bestNetApyText} net`}
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Staking issuance
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>
              {metrics.stakingIssuancePct === null ? '—' : fmtPct(metrics.stakingIssuancePct, 2)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {metrics.stakingIssuanceAnnualUM === null
              ? 'fixed budget / block'
              : `${fmtM(metrics.stakingIssuanceAnnualUM)}/yr — the only new supply`}
          </Text>
        </div>
        <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            LQT payout
          </Text>
          <Text large color='text.primary'>
            <span className='font-mono'>
              {metrics.lqtIncentivePct === null ? '—' : fmtPct(metrics.lqtIncentivePct, 2)}
            </span>
          </Text>
          <Text small color='text.secondary'>
            {lqtIncentiveText(metrics)}
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
            net of {metrics.burnAnnualizedPct === null ? '—' : fmtPct(metrics.burnAnnualizedPct, 3)}{' '}
            burns
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
            <span className='font-mono'>{(issuedSinceGenesis / 1_000_000).toFixed(2)}M UM</span>
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
        For comparison: BTC ~0.85%/yr post-2024 halving, ZEC ~4%/yr post-2024 halving, ETH net
        ~0.4%/yr, most Cosmos chains 7–20%, Solana ~5%. Penumbra mints a fixed staking budget that
        stays roughly constant regardless of participation; nothing else is minted, and the LQT is
        paid out of the community pool rather than new supply. DEX fee burns and MEV arb burns run
        against that issuance, so a busy DEX can push realized inflation below zero. Staking APY is
        high next to the {mintText} mint rate only because so little stake sits with active
        validators: the same budget over all bonded UM pays {bondedYieldText}. As more UM becomes
        actively bonded, the staking APY above falls proportionally.
        {metrics.delegatorApyPct !== null && (
          <>
            {' '}
            Commission is skimmed before delegators are paid, and today {commissionShareText} of the
            budget goes to it, so the realized power-weighted average is {netApyText} — the range
            across active validators runs from{' '}
            {metrics.minDelegatorApyPct === null ? '—' : fmtPct(metrics.minDelegatorApyPct, 2)} (a
            validator routing all of its rewards away from delegators) to {bestNetApyText}.
          </>
        )}
      </Text>
    </section>
  );
};

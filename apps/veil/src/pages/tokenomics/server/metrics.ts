'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';
import { fetchChainIssuanceParams } from './chain-params';
import { fetchCommunityPoolUM } from './community-pool';
import { fetchActiveSetYields } from './validator-rates';

// Penumbra mainnet block cadence — approx. 5s blocks => ~17280 blocks/day.
// This is only a last-resort fallback: real annualization uses
// `blocksPerYearEmpirical`, measured from the most recent blocks (see
// findRecentCadence) with the 30d supply window as the next fallback.
//
// Issuance model: `distributions_params.staking_issuance_per_block` is a
// FIXED per-block budget of new UM, paid out each epoch to whichever
// validators are in the ACTIVE set (jailed/disabled/tombstoned validators
// mint nothing — their per-validator exchange rate is frozen). The *payout*
// is capped at that budget (the epoch reward is budget-balanced, enforced by
// a circuit breaker), but the *rate* is not capped: the epoch's rate is
// budget ÷ active stake (stake/component/epoch_handler.rs `process_chain_base_rate`),
// so it rises as active stake shrinks. A "max ~2%" reading is that budget
// spread over ALL bonded UM — an average across stake that is not in the
// active set, not a ceiling.
//
// The LQT budget is NOT issuance: per the proto,
// `liquidity_tournament_incentive_per_block` is the amount of UM "flowing
// from the community pool to the liquidity tournament each block", so it
// redistributes existing supply instead of minting. Verified against
// pindexer: 30d supply growth tracks the staking budget alone (26,007 UM
// observed vs 26,485 UM budgeted in the last window), while LQT pays out
// ~1.2M UM/yr. Counting it as inflation overstates emissions ~4x.
// See chain-params.ts.
const SECONDS_PER_DAY = 86_400;
const PENUMBRA_BLOCK_TIME_S = 5;
const BLOCKS_PER_DAY = SECONDS_PER_DAY / PENUMBRA_BLOCK_TIME_S; // 17280

const UM_UNIT = 1_000_000; // upenumbra → UM
const toUM = (raw: bigint | number | string | null | undefined): number =>
  raw === null || raw === undefined ? 0 : Number(raw) / UM_UNIT;

export interface TokenomicsMetrics {
  // Latest snapshot
  latestHeight: number;
  totalSupply: number;
  // `bondedSupply` is every UM that's currently delegated — including
  // delegations to inactive validators, queued, and unbonding.
  // `activeStakedSupply` is the subset securing the chain right now —
  // delegations to active validators only. The headline cards show the
  // active number; the bonded number is available for tooltips.
  bondedSupply: number;
  bondedPct: number;
  activeStakedSupply: number;
  activeStakedPct: number;
  // Number of validators currently in the active set — the only ones that
  // mint staking rewards. Everyone else is jailed/disabled/tombstoned.
  activeValidatorCount: number;
  priceUsd: number | null;
  marketCapUsd: number | null;

  // Permanent burns (arb + fees from supply_total_unstaked)
  arbBurned: number;
  feeBurned: number;
  totalBurned: number;
  burnedPctOfEffective: number; // burned / (current + burned)

  // Locked-but-recoverable
  dexLocked: number;
  auctionLocked: number;

  // Realized inflation, annualized from a 30d supply window (net of burns)
  annualizedInflationPct: number | null;
  // 30d annualized burn rate — how fast fee + arb burns eat supply. Adding
  // this to annualizedInflationPct recovers *gross* issuance over the window.
  burnAnnualizedPct: number | null;

  // Delegated to jailed/disabled validators — bonded but earning zero.
  // Surfaced separately from active because it materially changes the
  // "how much of supply is productive?" picture.
  inactiveBondedSupply: number;
  inactiveBondedPct: number;

  // Community pool balance (protocol-owned UM). NOT indexed by pindexer —
  // supply.rs folds it into supply_total_unstaked.um at genesis and on
  // every EventFundingStreamReward, so peeling it out here uses the pd
  // node's CommunityPoolAssetBalances RPC. NULL if the endpoint is
  // unreachable; UI falls back to lumping it inside free float and says so.
  communityPoolUM: number | null;
  communityPoolPct: number | null;

  // Chain-configured issuance (from AppParameters). NULL if the app-side
  // gRPC endpoint is unreachable — in that case the page falls back to the
  // observed-only view.
  stakingIssuancePerBlockUM: number | null; // UM/block minted for staking
  lqtIncentivePerBlockUM: number | null; // UM/block paid out of the community pool
  lqtEndBlock: number | null;
  currentBlockHeight: number;
  // Derived from the chain params + empirical blocks/year (see below).
  stakingIssuanceAnnualUM: number | null; // absolute UM/year minted for staking
  lqtIncentiveAnnualUM: number | null; // absolute UM/year out of the pool (0 if past end)
  stakingIssuancePct: number | null; // staking-only, % of supply — the only minted stream
  lqtIncentivePct: number | null; // LQT outflow, % of supply (0 if past end)
  // The number the old page mislabeled as "inflation ceiling": gross
  // per-ACTIVE-staker APY before validator commission. Denominator is the
  // active set only (≈3.1M UM of 18.8M bonded), because jailed/disabled
  // validators mint nothing.
  stakingApyPct: number | null;
  // The same fixed budget spread over EVERY bonded UM: the network-wide
  // average payoff. Equals stakingIssuanceAnnualUM / bondedSupply, always
  // below stakingApyPct, and it is what the ~15.7M UM delegated to inactive
  // validators would earn if the chain paid them (it does not).
  bondedStakingYieldPct: number | null;
  // Blocks/year at the CURRENT block cadence, sampled from the most
  // recent blocks (2k of them, ≈2.8h) with the 30d supply window and then the
  // nominal 5s as fallbacks. Issuance is minted per block, so the annualization
  // must use today's cadence: mainnet drifted from ~6.5s to ~5.0s/block over
  // the last month, which moves every emission-derived APY by >20%.
  blocksPerYearEmpirical: number | null;
  // Seconds per block used for that annualization (the same measurement,
  // inverted) so the page can show its own input instead of asking readers to
  // trust 10.4% vs 12.8% blindly. NULL only if every measurement failed.
  blockTimeSeconds: number | null;
  // Epochs completed per year at the measured cadence (blocksPerYearEmpirical
  // / sct_params.epoch_duration). The staking rate data refreshes once per
  // epoch, so this is the annualization factor that turns the chain's
  // per-epoch reward rate into an APY. Exposed so other pages can reuse the
  // same factor instead of re-measuring block times. NULL without chain params.
  epochsPerYear: number | null;

  // Realized per-delegator yield, read off the chain's own per-validator
  // `rate_data.validator_reward_rate` and net of each validator's commission.
  // This is what an average actively-bonded UM is actually paid — unlike
  // stakingApyPct it accounts for commission (≈41% of the budget today) and
  // for validators whose streams pay delegators nothing. NULL if the stake
  // endpoint is unreachable; the page then shows the pre-commission view only.
  delegatorApyPct: number | null;
  // Best active validator (lowest commission): the practical ceiling.
  maxDelegatorApyPct: number | null;
  // Worst active validator (commission routing every reward away from
  // delegators), so the spread across the active set is observable.
  minDelegatorApyPct: number | null;
  // Share of the staking issuance budget paid out as validator commission
  // (power-weighted; 41% of it today).
  commissionShareOfIssuancePct: number | null;
  // Largest active validator: its share of the active stake and its
  // commission. One validator at a high commission is what pulls the
  // power-weighted average below the best rate.
  largestValidatorPowerPct: number | null;
  largestValidatorCommissionBps: number | null;

  // 24h activity (joins on dex_ex_aggregate_summary, which we already use on /explore)
  dexVolume24h: number | null;
  trades24h: number | null;
  burned24h: number | null;

  // Genesis reference: total UM at height 0, read from insights_supply.
  // (The old hard-coded 95.32M was the genesis allocation *excluding* the
  // community pool's share, which made "issued since genesis" — supply
  // minus that baseline — overstate real minting ~7x.)
  genesisAllocation: number;
  blocksPerDay: number;
}

const findRowAtOrBefore = async (targetTimestamp: Date) => {
  // Find the insights_supply row whose joined block timestamp is closest <=
  // target. We do max(height) over rows joined where ts <= target.
  return pindexerDb
    .selectFrom('insights_supply')
    .innerJoin('block_details', 'block_details.height', 'insights_supply.height')
    .select([
      'insights_supply.height as height',
      'insights_supply.total as total',
      'block_details.timestamp as timestamp',
    ])
    .where('block_details.timestamp', '<=', targetTimestamp)
    .orderBy('block_details.timestamp', 'desc')
    .limit(1)
    .executeTakeFirst();
};

// Forward-looking cadence. The staking budget is minted *per block*, so the
// annualization of that budget has to use the cadence the chain is producing
// now — not a 30-day average. Mainnet has run between ~5.0s and ~6.5s per
// block over the last month, which swings the published APY by >20%. Sample
// the most recent blocks, then fall back to the 30d supply window, then to the
// 5s constant. Anything outside the plausible range is treated as noise.
const CADENCE_SAMPLE_BLOCKS = 2_000;
const CADENCE_MIN_BLOCKS = 300;
const MIN_PLAUSIBLE_BLOCK_TIME_S = 1;
const MAX_PLAUSIBLE_BLOCK_TIME_S = 60;

// Both measurements below share the same acceptance rule: a cadence outside
// this range is noise (a stalled chain, a resync, a gap in indexing) and is
// worse to publish than the nominal 5s fallback.
const cadenceFromDeltas = (
  heightDelta: number,
  secondsDelta: number,
): { blocksPerYear: number; blockTimeSeconds: number } | null => {
  if (heightDelta <= 0 || secondsDelta <= 0) {
    return null;
  }
  const blockTimeSeconds = secondsDelta / heightDelta;
  if (
    blockTimeSeconds < MIN_PLAUSIBLE_BLOCK_TIME_S ||
    blockTimeSeconds > MAX_PLAUSIBLE_BLOCK_TIME_S
  ) {
    return null;
  }
  return {
    blocksPerYear: (SECONDS_PER_DAY * 365) / blockTimeSeconds,
    blockTimeSeconds,
  };
};

const findRecentCadence = async (): Promise<{
  blocksPerYear: number;
  blockTimeSeconds: number;
} | null> => {
  const rows = await pindexerDb
    .selectFrom('block_details')
    .select(['height', 'timestamp'])
    .orderBy('height', 'desc')
    .limit(CADENCE_SAMPLE_BLOCKS)
    .execute();
  if (rows.length < CADENCE_MIN_BLOCKS) {
    return null;
  }
  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  if (!newest || !oldest) {
    return null;
  }
  const heightDelta = Number(newest.height) - Number(oldest.height);
  const secondsDelta =
    (new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime()) / 1000;
  if (heightDelta < CADENCE_MIN_BLOCKS) {
    return null;
  }
  return cadenceFromDeltas(heightDelta, secondsDelta);
};

const findUnstakedAtOrBefore = async (targetTimestamp: Date) => {
  return pindexerDb
    .selectFrom('supply_total_unstaked')
    .innerJoin('block_details', 'block_details.height', 'supply_total_unstaked.height')
    .select([
      'supply_total_unstaked.height as height',
      'supply_total_unstaked.arb as arb',
      'supply_total_unstaked.fees as fees',
      'block_details.timestamp as timestamp',
    ])
    .where('block_details.timestamp', '<=', targetTimestamp)
    .orderBy('block_details.timestamp', 'desc')
    .limit(1)
    .executeTakeFirst();
};

const computeTokenomicsMetrics = async (): Promise<TokenomicsMetrics> => {
  // Run the independent queries in parallel.
  const [
    latestSupply,
    latestUnstaked,
    summary24h,
    supply30dAgo,
    activeStakedRow,
    unstaked24hAgo,
    unstaked30dAgo,
    chainParams,
    communityPoolUMValue,
    latestBlockRow,
    genesisRow,
    recentCadence,
  ] = await Promise.all([
    pindexerDb
      .selectFrom('insights_supply')
      .select(['height', 'total', 'staked', 'market_cap', 'price'])
      .orderBy('height', 'desc')
      .limit(1)
      .executeTakeFirst(),
    pindexerDb
      .selectFrom('supply_total_unstaked')
      .select(['height', 'um', 'auction', 'dex', 'arb', 'fees'])
      .orderBy('height', 'desc')
      .limit(1)
      .executeTakeFirst(),
    pindexerDb
      .selectFrom('dex_ex_aggregate_summary')
      .select(['direct_volume', 'trades'])
      .where('the_window', '=', '1d')
      .executeTakeFirst(),
    findRowAtOrBefore(new Date(Date.now() - 30 * SECONDS_PER_DAY * 1000)),
    // Active stake = delegations counted toward voting power right now.
    // supply_total_staked has per-validator latest UM; stake_validator_set
    // tells us which of those are in the active set. Group by validator,
    // pick the latest height per validator, then sum where the validator
    // is currently active. validator_state is JSONB
    // ({"state":"VALIDATOR_STATE_ENUM_ACTIVE"}), so we extract via ->>.
    // Excludes Disabled, Jailed, Tombstoned, Defined — those validators
    // may still hold UM but their stake doesn't secure the network.
    pindexerDb
      .selectFrom('supply_total_staked as sts')
      .innerJoin('stake_validator_set as svs', 'svs.id', 'sts.validator_id')
      .select([sql<bigint>`SUM(sts.um)`.as('um'), sql<bigint>`COUNT(*)`.as('n')])
      .where(sql`svs.validator_state::jsonb->>'state'`, '=', 'VALIDATOR_STATE_ENUM_ACTIVE')
      .where(
        'sts.height',
        '=',
        sql<string>`(SELECT MAX(height) FROM supply_total_staked sts2 WHERE sts2.validator_id = sts.validator_id)`,
      )
      .executeTakeFirst(),
    findUnstakedAtOrBefore(new Date(Date.now() - SECONDS_PER_DAY * 1000)),
    // 30d burn snapshot — pairs with supply30dAgo so the annualized
    // burn rate uses the same window as annualized inflation.
    findUnstakedAtOrBefore(new Date(Date.now() - 30 * SECONDS_PER_DAY * 1000)),
    // Chain-configured issuance (may be null if the pd endpoint is
    // unreachable — the page copes).
    fetchChainIssuanceParams(),
    // Community pool balance (UM only) via the pd node's asset-balances
    // stream, filtered by the UM asset id. See community-pool.ts.
    fetchCommunityPoolUM(),
    // Latest block height + timestamp — used to know whether LQT is
    // still active (compare against liquidity_tournament_end_block).
    pindexerDb
      .selectFrom('block_details')
      .select(['height', 'timestamp'])
      .orderBy('height', 'desc')
      .limit(1)
      .executeTakeFirst(),
    // Genesis total supply — baseline for "issued since genesis". Using
    // the DB rather than a constant keeps the baseline consistent with
    // the same series the rest of the page reads.
    pindexerDb
      .selectFrom('insights_supply')
      .select(['height', 'total'])
      .orderBy('height', 'asc')
      .limit(1)
      .executeTakeFirst(),
    // Current block cadence (see findRecentCadence). Fail-soft: null falls
    // back to the 30d window, then to the 5s constant.
    findRecentCadence().catch(() => null),
  ]);

  if (!latestSupply) {
    throw new Error('insights_supply is empty — pindexer not caught up?');
  }

  const totalSupply = toUM(latestSupply.total);
  // `insights_supply.staked` aggregates all bonded UM regardless of
  // validator state. The active-set sum is computed separately below.
  const bondedSupply = toUM(latestSupply.staked);
  const bondedPct = totalSupply > 0 ? (bondedSupply / totalSupply) * 100 : 0;
  const activeStakedSupply = toUM(activeStakedRow?.um ?? 0);
  const activeStakedPct = totalSupply > 0 ? (activeStakedSupply / totalSupply) * 100 : 0;
  // insights_supply.market_cap is stored in upenumbra atomic units of price ×
  // supply, so divide once like supply.
  const marketCapUsd = latestSupply.market_cap ? toUM(latestSupply.market_cap) : null;
  const priceUsd = latestSupply.price ?? null;

  const arbBurned = toUM(latestUnstaked?.arb ?? 0);
  // `fees` may be stored as a negative running counter; tokenomic uses |fees|.
  const feeBurned = Math.abs(toUM(latestUnstaked?.fees ?? 0));
  const totalBurned = arbBurned + feeBurned;
  const burnedPctOfEffective =
    totalSupply + totalBurned > 0 ? (totalBurned / (totalSupply + totalBurned)) * 100 : 0;

  const dexLocked = Math.abs(toUM(latestUnstaked?.dex ?? 0));
  const auctionLocked = toUM(latestUnstaked?.auction ?? 0);

  let annualizedInflationPct: number | null = null;
  let burnAnnualizedPct: number | null = null;
  // Cadence used for every emission annualization below. Latest blocks win;
  // the 30d supply window and the 5s constant are only fallbacks (see
  // findRecentCadence).
  let blocksPerYearEmpirical: number | null = recentCadence?.blocksPerYear ?? null;
  let blockTimeSeconds: number | null = recentCadence?.blockTimeSeconds ?? null;
  if (supply30dAgo) {
    const past = toUM(supply30dAgo.total);
    if (past > 0) {
      const windowDays =
        (new Date().getTime() - new Date(supply30dAgo.timestamp).getTime()) /
        (1000 * SECONDS_PER_DAY);
      const windowChangePct = ((totalSupply - past) / past) * 100;
      // Annualize: scale the window rate to a 365d basis.
      annualizedInflationPct = windowDays > 0 ? windowChangePct * (365 / windowDays) : null;

      // Burn rate over the same 30d window. Both `arb` and |fees| are
      // monotonic counters; a resync can briefly reorder them so we clamp
      // at zero rather than emit negative burn rates.
      if (unstaked30dAgo) {
        const past30dBurn = toUM(unstaked30dAgo.arb) + Math.abs(toUM(unstaked30dAgo.fees));
        const nowBurn = arbBurned + feeBurned;
        const burnDelta = Math.max(0, nowBurn - past30dBurn);
        if (windowDays > 0 && totalSupply > 0) {
          burnAnnualizedPct = (burnDelta / totalSupply) * 100 * (365 / windowDays);
        }
      }

      // Fallback cadence: block cadence averaged over the 30d supply window.
      // Only used when the recent-block sample is unavailable; the emission is
      // per block, so a month-old average would misstate today's APY whenever
      // the chain's block time has drifted (it has: ~6.5s → ~5.0s).
      if (blocksPerYearEmpirical === null && latestBlockRow) {
        const heightDelta = Number(latestBlockRow.height) - Number(supply30dAgo.height);
        const timestampMsDelta =
          new Date(latestBlockRow.timestamp).getTime() - new Date(supply30dAgo.timestamp).getTime();
        const fallbackCadence = cadenceFromDeltas(heightDelta, timestampMsDelta / 1000);
        if (fallbackCadence) {
          blocksPerYearEmpirical = fallbackCadence.blocksPerYear;
          blockTimeSeconds = fallbackCadence.blockTimeSeconds;
        }
      }
    }
  }
  if (blocksPerYearEmpirical === null) {
    // Last resort: the nominal 5s cadence.
    blocksPerYearEmpirical = BLOCKS_PER_DAY * 365;
    blockTimeSeconds = PENUMBRA_BLOCK_TIME_S;
  }

  // Chain-configured, fixed-budget issuance. When AppParameters is
  // unreachable we drop the whole block — page falls back to the
  // observed-only view rather than shipping stale/faked numbers.
  const currentBlockHeight = latestBlockRow ? Number(latestBlockRow.height) : 0;
  let stakingIssuancePerBlockUM: number | null = null;
  let lqtIncentivePerBlockUM: number | null = null;
  let lqtEndBlock: number | null = null;
  let stakingIssuanceAnnualUM: number | null = null;
  let lqtIncentiveAnnualUM: number | null = null;
  let stakingIssuancePct: number | null = null;
  let lqtIncentivePct: number | null = null;
  let stakingApyPct: number | null = null;
  let bondedStakingYieldPct: number | null = null;
  if (chainParams) {
    stakingIssuancePerBlockUM = chainParams.stakingIssuancePerBlock / UM_UNIT;
    lqtIncentivePerBlockUM = chainParams.lqtIncentivePerBlock / UM_UNIT;
    lqtEndBlock = chainParams.lqtEndBlock;
    stakingIssuanceAnnualUM = stakingIssuancePerBlockUM * blocksPerYearEmpirical;
    // LQT sunsets: after `lqt_end_block` the schedule pays nothing,
    // regardless of the per-block rate still living in params.
    const lqtActive = currentBlockHeight > 0 && currentBlockHeight < chainParams.lqtEndBlock;
    lqtIncentiveAnnualUM = lqtActive ? lqtIncentivePerBlockUM * blocksPerYearEmpirical : 0;
    if (totalSupply > 0) {
      // Only staking issuance mints. The LQT stream moves UM out of the
      // community pool, so it is a flow, not inflation.
      stakingIssuancePct = (stakingIssuanceAnnualUM / totalSupply) * 100;
      lqtIncentivePct = (lqtIncentiveAnnualUM / totalSupply) * 100;
    }
    // Pre-commission gross APY on active bonded stake. Only the active
    // set earns staking issuance — bonded-to-inactive-validators earns
    // nothing, so it's excluded from this denominator.
    if (activeStakedSupply > 0 && stakingIssuanceAnnualUM > 0) {
      stakingApyPct = (stakingIssuanceAnnualUM / activeStakedSupply) * 100;
    }
    // Same fixed budget, spread over every bonded UM.
    if (bondedSupply > 0 && stakingIssuanceAnnualUM > 0) {
      bondedStakingYieldPct = (stakingIssuanceAnnualUM / bondedSupply) * 100;
    }
  }

  const inactiveBondedSupply = Math.max(0, bondedSupply - activeStakedSupply);
  const inactiveBondedPct = totalSupply > 0 ? (inactiveBondedSupply / totalSupply) * 100 : 0;

  // Realized yields need the epoch cadence, so this runs after the chain
  // params land (and is itself cached for an hour). Fail-soft: null keeps the
  // pre-commission view on the page.
  const activeSetYields =
    chainParams && chainParams.epochBlocks > 0
      ? await fetchActiveSetYields(blocksPerYearEmpirical / chainParams.epochBlocks)
      : null;

  return {
    latestHeight: Number(latestSupply.height),
    totalSupply,
    bondedSupply,
    bondedPct,
    activeStakedSupply,
    activeStakedPct,
    activeValidatorCount: Number(activeStakedRow?.n ?? 0),
    priceUsd,
    marketCapUsd,
    arbBurned,
    feeBurned,
    totalBurned,
    burnedPctOfEffective,
    dexLocked,
    auctionLocked,
    annualizedInflationPct,
    burnAnnualizedPct,
    inactiveBondedSupply,
    inactiveBondedPct,
    communityPoolUM: communityPoolUMValue,
    communityPoolPct:
      communityPoolUMValue !== null && totalSupply > 0
        ? (communityPoolUMValue / totalSupply) * 100
        : null,
    stakingIssuancePerBlockUM,
    lqtIncentivePerBlockUM,
    lqtEndBlock,
    currentBlockHeight,
    stakingIssuanceAnnualUM,
    lqtIncentiveAnnualUM,
    stakingIssuancePct,
    lqtIncentivePct,
    stakingApyPct,
    bondedStakingYieldPct,
    delegatorApyPct: activeSetYields?.weightedNetApyPct ?? null,
    maxDelegatorApyPct: activeSetYields?.maxNetApyPct ?? null,
    minDelegatorApyPct: activeSetYields?.minNetApyPct ?? null,
    commissionShareOfIssuancePct:
      activeSetYields === null ? null : activeSetYields.weightedCommissionBps / 100,
    largestValidatorPowerPct:
      activeSetYields?.largest && activeSetYields.powerUM > 0
        ? (activeSetYields.largest.powerUM / activeSetYields.powerUM) * 100
        : null,
    largestValidatorCommissionBps: activeSetYields?.largest?.commissionBps ?? null,
    blocksPerYearEmpirical,
    blockTimeSeconds,
    epochsPerYear:
      chainParams && chainParams.epochBlocks > 0
        ? blocksPerYearEmpirical / chainParams.epochBlocks
        : null,
    dexVolume24h: summary24h ? toUM(summary24h.direct_volume) : null,
    trades24h: summary24h?.trades ?? null,
    // Delta of the cumulative arb+fees burn counters over the last 24h.
    // Both counters are monotonic (burns don't reverse); |Δ| guards a
    // rare pindexer resync where the historic row is briefly ahead.
    burned24h: unstaked24hAgo
      ? Math.abs(arbBurned - toUM(unstaked24hAgo.arb)) +
        Math.abs(feeBurned - Math.abs(toUM(unstaked24hAgo.fees)))
      : null,
    genesisAllocation: genesisRow ? toUM(genesisRow.total) : 100_000_000,
    blocksPerDay: BLOCKS_PER_DAY,
  };
};

// One snapshot costs ~10 pindexer queries plus two gRPC reads (community
// pool, per-validator reward rates). The validator pages reuse the same
// numbers — the inflation reference and the epoch cadence — so memoize for
// 120s: short enough that "latest snapshot" stays honest, long enough that a
// page view doesn't re-read the whole chain. Single-flight so concurrent
// renders share one computation.
const METRICS_TTL_MS = 120_000;
let cachedMetrics: { at: number; value: TokenomicsMetrics } | null = null;
let inflightMetrics: Promise<TokenomicsMetrics> | null = null;

export async function fetchTokenomicsMetrics(): Promise<TokenomicsMetrics> {
  const now = Date.now();
  if (cachedMetrics && now - cachedMetrics.at < METRICS_TTL_MS) {
    return cachedMetrics.value;
  }
  inflightMetrics ??= computeTokenomicsMetrics()
    .then(value => {
      cachedMetrics = { at: Date.now(), value };
      return value;
    })
    .catch((err: unknown) => {
      // pindexer blip: serve the last snapshot rather than failing the page.
      // Only rethrow when there is nothing to serve.
      if (cachedMetrics) {
        console.warn('[tokenomics] metrics refresh failed, serving cached', err);
        return cachedMetrics.value;
      }
      throw err;
    })
    .finally(() => {
      inflightMetrics = null;
    });
  return inflightMetrics;
}

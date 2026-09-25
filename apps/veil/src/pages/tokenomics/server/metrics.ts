'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';
import { fetchChainIssuanceParams } from './chain-params';
import { fetchCommunityPoolUM } from './community-pool';

// Penumbra mainnet block cadence — approx. 5s blocks => ~17280 blocks/day.
// This is only a fallback: real annualization uses `blocksPerYearEmpirical`
// (see below) which measures actual cadence from block_details timestamps.
//
// Issuance model: `distributions_params.staking_issuance_per_block` is a
// FIXED per-block budget of new UM paid out to the active validator set
// each epoch. The rate does not scale with participation — the network
// mints the same UM whether 2% or 80% is bonded; what changes is the
// per-staker share (APY = issuance / active_bonded). Same shape for the
// LQT budget, which sunsets at `liquidity_tournament_end_block`. See
// chain-params.ts.
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
  stakingIssuancePerBlockUM: number | null;   // UM/block for staking
  lqtIssuancePerBlockUM: number | null;       // UM/block for LP tournament
  lqtEndBlock: number | null;
  currentBlockHeight: number;
  // Derived from the chain params + empirical blocks/year (see below).
  stakingIssuanceAnnualUM: number | null;     // absolute UM/year for staking
  lqtIssuanceAnnualUM: number | null;         // absolute UM/year for LQT (0 if past end)
  stakingIssuancePct: number | null;          // staking-only, % of supply
  lqtIssuancePct: number | null;              // LQT, % of supply (0 if past end)
  grossIssuancePct: number | null;            // combined, % of supply
  // The number the old page mislabeled as "inflation ceiling". This is
  // actually gross per-active-staker APY before validator commission.
  stakingApyPct: number | null;
  // Blocks/year measured from the 30d supply window's timestamps — replaces
  // the hard-coded 5s block time so the annualization survives any block-time
  // drift.
  blocksPerYearEmpirical: number | null;

  // 24h activity (joins on dex_ex_aggregate_summary, which we already use on /explore)
  dexVolume24h: number | null;
  trades24h: number | null;
  burned24h: number | null;

  // Genesis reference
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

export async function fetchTokenomicsMetrics(): Promise<TokenomicsMetrics> {
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
        .select(sql<bigint>`SUM(sts.um)`.as('um'))
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
  let blocksPerYearEmpirical: number | null = null;
  if (supply30dAgo) {
    const past = toUM(supply30dAgo.total);
    if (past > 0) {
      const windowDays =
        (new Date().getTime() - new Date(supply30dAgo.timestamp).getTime()) /
        (1000 * SECONDS_PER_DAY);
      const windowChangePct = ((totalSupply - past) / past) * 100;
      // Annualize: scale the window rate to a 365d basis.
      annualizedInflationPct =
        windowDays > 0 ? windowChangePct * (365 / windowDays) : null;

      // Burn rate over the same 30d window. Both `arb` and |fees| are
      // monotonic counters; a resync can briefly reorder them so we clamp
      // at zero rather than emit negative burn rates.
      if (unstaked30dAgo) {
        const past30dBurn =
          toUM(unstaked30dAgo.arb) + Math.abs(toUM(unstaked30dAgo.fees));
        const nowBurn = arbBurned + feeBurned;
        const burnDelta = Math.max(0, nowBurn - past30dBurn);
        if (windowDays > 0 && totalSupply > 0) {
          burnAnnualizedPct = (burnDelta / totalSupply) * 100 * (365 / windowDays);
        }
      }

      // Empirical blocks/year: measure block cadence over the 30d window
      // from the recorded heights. Falls back to the 5s constant if either
      // endpoint is missing.
      if (latestBlockRow && supply30dAgo.timestamp) {
        const heightDelta = Number(latestBlockRow.height) - Number(supply30dAgo.height);
        const timestampMsDelta =
          new Date(latestBlockRow.timestamp).getTime() -
          new Date(supply30dAgo.timestamp).getTime();
        if (heightDelta > 0 && timestampMsDelta > 0) {
          const blocksPerSec = heightDelta / (timestampMsDelta / 1000);
          blocksPerYearEmpirical = blocksPerSec * SECONDS_PER_DAY * 365;
        }
      }
    }
  }
  if (blocksPerYearEmpirical == null) {
    blocksPerYearEmpirical = BLOCKS_PER_DAY * 365;
  }

  // Chain-configured, fixed-budget issuance. When AppParameters is
  // unreachable we drop the whole block — page falls back to the
  // observed-only view rather than shipping stale/faked numbers.
  const currentBlockHeight = latestBlockRow ? Number(latestBlockRow.height) : 0;
  let stakingIssuancePerBlockUM: number | null = null;
  let lqtIssuancePerBlockUM: number | null = null;
  let lqtEndBlock: number | null = null;
  let stakingIssuanceAnnualUM: number | null = null;
  let lqtIssuanceAnnualUM: number | null = null;
  let stakingIssuancePct: number | null = null;
  let lqtIssuancePct: number | null = null;
  let grossIssuancePct: number | null = null;
  let stakingApyPct: number | null = null;
  if (chainParams) {
    stakingIssuancePerBlockUM = chainParams.stakingIssuancePerBlock / UM_UNIT;
    lqtIssuancePerBlockUM = chainParams.lqtIssuancePerBlock / UM_UNIT;
    lqtEndBlock = chainParams.lqtEndBlock;
    stakingIssuanceAnnualUM = stakingIssuancePerBlockUM * blocksPerYearEmpirical;
    // LQT sunsets: after `lqt_end_block` the schedule pays nothing,
    // regardless of the per-block rate still living in params.
    const lqtActive = currentBlockHeight > 0 && currentBlockHeight < chainParams.lqtEndBlock;
    lqtIssuanceAnnualUM = lqtActive
      ? lqtIssuancePerBlockUM * blocksPerYearEmpirical
      : 0;
    if (totalSupply > 0) {
      stakingIssuancePct = (stakingIssuanceAnnualUM / totalSupply) * 100;
      lqtIssuancePct = (lqtIssuanceAnnualUM / totalSupply) * 100;
      grossIssuancePct = stakingIssuancePct + lqtIssuancePct;
    }
    // Pre-commission gross APY on active bonded stake. Only the active
    // set earns staking issuance — bonded-to-inactive-validators earns
    // nothing, so it's excluded from this denominator.
    if (activeStakedSupply > 0 && stakingIssuanceAnnualUM > 0) {
      stakingApyPct = (stakingIssuanceAnnualUM / activeStakedSupply) * 100;
    }
  }

  const inactiveBondedSupply = Math.max(0, bondedSupply - activeStakedSupply);
  const inactiveBondedPct =
    totalSupply > 0 ? (inactiveBondedSupply / totalSupply) * 100 : 0;

  return {
    latestHeight: Number(latestSupply.height),
    totalSupply,
    bondedSupply,
    bondedPct,
    activeStakedSupply,
    activeStakedPct,
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
    lqtIssuancePerBlockUM,
    lqtEndBlock,
    currentBlockHeight,
    stakingIssuanceAnnualUM,
    lqtIssuanceAnnualUM,
    stakingIssuancePct,
    lqtIssuancePct,
    grossIssuancePct,
    stakingApyPct,
    blocksPerYearEmpirical,
    dexVolume24h: summary24h ? toUM(summary24h.direct_volume) : null,
    trades24h: summary24h?.trades ?? null,
    // Delta of the cumulative arb+fees burn counters over the last 24h.
    // Both counters are monotonic (burns don't reverse); |Δ| guards a
    // rare pindexer resync where the historic row is briefly ahead.
    burned24h: unstaked24hAgo
      ? Math.abs(arbBurned - toUM(unstaked24hAgo.arb)) +
        Math.abs(feeBurned - Math.abs(toUM(unstaked24hAgo.fees)))
      : null,
    genesisAllocation: 95_316_205, // mainnet genesis allocation ≈ 95.3M UM
    blocksPerDay: BLOCKS_PER_DAY,
  };
}

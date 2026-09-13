'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';

// Penumbra mainnet block cadence — approx. 5s blocks => ~17280 blocks/day.
// Genesis sets stakingIssuancePerBlock as a base rate that's then scaled
// by validator-specific reward rates; the realized inflation is computed
// from observed supply changes (see annualizedInflationPct below) rather
// than from this constant alone.
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

  // Realized inflation, annualized from a 30d supply window
  annualizedInflationPct: number | null;

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
          sql`(SELECT MAX(height) FROM supply_total_staked sts2 WHERE sts2.validator_id = sts.validator_id)`,
        )
        .executeTakeFirst(),
      findUnstakedAtOrBefore(new Date(Date.now() - SECONDS_PER_DAY * 1000)),
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
    }
  }

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

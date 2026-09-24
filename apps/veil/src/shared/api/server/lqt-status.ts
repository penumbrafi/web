import { NextResponse } from 'next/server';
import { pindexerDb } from '@/shared/database/client';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';

/**
 * Whether the Liquidity Tournament is live, read from the chain via pindexer.
 *
 * The chain's distributions component adds `liquidity_tournament_incentive_per_block`
 * to the current epoch's pool at every `end_block` and emits
 * `EventLqtPoolSizeIncrease`; pindexer writes the running total into
 * `lqt._epoch_info.available_rewards`. Once `liquidity_tournament_end_block`
 * passes, the chain zeroes the pool itself. So:
 *
 *   active  ⇔  the current epoch has accrued a non-zero pool
 *
 * turns on one block after governance funds the tournament and off by itself
 * when it ends — nothing in this repo has to be flipped either way.
 *
 * Deliberately NOT `lqt.summary.total_rewards`: for the open epoch that view
 * projects the pool from `rewards_per_block`, which ignores the end block, and
 * so keeps promising rewards the chain is zeroing (it projected ~14.5k UM for
 * epoch 443 while the chain was issuing nothing).
 */
export interface TournamentStatus {
  active: boolean;
  /** Current epoch index, or null if the indexer has no LQT epochs yet. */
  epoch: number | null;
  /** Pool accrued so far this epoch, in base units (string: Postgres NUMERIC). */
  accruedRewards: string;
}

/**
 * True when an accrued pool (Postgres NUMERIC, as a string of base units) is
 * non-zero. Compared as a BigInt so a pool above 2^53 base units cannot round.
 */
export const isFundedPool = (accrued: string): boolean =>
  // `BigInt('')` is 0n, so an empty integer part needs no special case.
  BigInt(accrued.trim().split('.')[0] ?? '0') > 0n;

// Fail CLOSED. If pindexer is unreachable we cannot confirm a funded pool, and
// advertising rewards we can't confirm is the failure this endpoint exists to
// prevent.
const INACTIVE: TournamentStatus = { active: false, epoch: null, accruedRewards: '0' };

async function handleGet(): Promise<NextResponse<TournamentStatus>> {
  const row = await withTimeout(
    pindexerDb
      .selectFrom('lqt._epoch_info')
      .select(['epoch', 'available_rewards'])
      .orderBy('epoch', 'desc')
      .limit(1)
      .executeTakeFirst(),
    DEFAULT_TIMEOUT_MS,
    'tournament/status lqt._epoch_info',
  );

  if (!row) {
    return NextResponse.json(INACTIVE);
  }

  const accrued = String(row.available_rewards);
  const active = isFundedPool(accrued);

  return NextResponse.json({ active, epoch: row.epoch, accruedRewards: accrued });
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: INACTIVE,
  logTag: 'tournament/status',
});

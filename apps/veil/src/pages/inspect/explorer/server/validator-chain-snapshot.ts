'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';
import { degrade } from './degrade';

/**
 * What pindexer knows about each validator, as one snapshot read.
 *
 * Two facts a delegator needs that the chain's GraphQL does not give:
 *
 *  - the bonded delegation stake per validator *right now*. GraphQL's
 *    `votingPower` only moves at epoch boundaries; `supply_total_staked` is
 *    written per block, and it is the number the stake component actually
 *    pays on.
 *  - the validators' *measured* reward rate. `rate_bps2` is the
 *    delegation-token exchange rate (UM per delegation token, 1e8 = 1.0) —
 *    the pool a delegator's tokens redeem into. Its growth over a window is
 *    the reward that validator actually credited: commission already
 *    deducted, jailing already priced in, independent of the mint schedule.
 *
 * Annualization here is linear (rate x periods/yr), not compounded: the
 * protocol adds a fixed UM budget to the pool each epoch, so the exchange
 * rate grows additively. The tokenomics page annualizes the same way.
 */

const UM_UNIT = 1_000_000; // upenumbra -> UM
const BPS_SQUARED = 1e8; // rate_bps2 scale: 1e8 == 1.0
const WINDOW_DAYS = 30;
/**
 * Below this the window says more about when pindexer started than about the
 * validator: annualizing a two-day series into a year is noise.
 */
const MIN_WINDOW_DAYS = 7;

export interface ValidatorChainSnapshot {
  /** 'ACTIVE' | 'JAILED' | 'DISABLED' | 'TOMBSTONED' | 'DEFINED' | 'UNBONDING'. */
  state: string;
  /** Bonded delegation stake in UM at the latest indexed height. */
  stakeUM: number;
  /**
   * Exchange-rate growth over the window, annualized, in percent — the
   * realized per-validator APY before nothing and after everything. NULL when
   * there is not enough indexed history to measure it.
   */
  realizedApyPct: number | null;
  /** Days actually measured (30 normally). NULL when unmeasurable. */
  windowDays: number | null;
}

interface SnapshotRow {
  ik: string;
  state: string | null;
  stake_um: string | null;
  rate_bps2: string | null;
  from_rate_bps2: string | null;
  t0: Date | null;
  t1: Date | null;
}

const stateLabel = (raw: string): string =>
  raw.replace(/^VALIDATOR_STATE_ENUM_/, '').toUpperCase();

/**
 * Per-validator snapshot keyed by identity key. Empty map when pindexer is
 * unreachable — callers fall back to the chain's epoch-boundary numbers rather
 * than showing nothing.
 */
export async function fetchValidatorChainSnapshots(): Promise<
  Map<string, ValidatorChainSnapshot>
> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const result = await sql<SnapshotRow>`
    WITH win AS (
      SELECT
        MAX(height) FILTER (WHERE timestamp <= ${since}) AS h0,
        MAX(timestamp) FILTER (WHERE timestamp <= ${since}) AS t0,
        MAX(timestamp) AS t1
      FROM block_details
    ),
    latest AS (
      SELECT DISTINCT ON (sts.validator_id)
        sts.validator_id, sts.um, sts.rate_bps2
      FROM supply_total_staked sts
      ORDER BY sts.validator_id, sts.height DESC
    ),
    at_window AS (
      SELECT DISTINCT ON (sts.validator_id)
        sts.validator_id, sts.rate_bps2
      FROM supply_total_staked sts, win
      WHERE sts.height <= win.h0
      ORDER BY sts.validator_id, sts.height DESC
    )
    SELECT
      svs.ik AS ik,
      svs.validator_state::jsonb->>'state' AS state,
      l.um AS stake_um,
      l.rate_bps2 AS rate_bps2,
      w.rate_bps2 AS from_rate_bps2,
      win.t0 AS t0,
      win.t1 AS t1
    FROM stake_validator_set svs
    JOIN latest l ON l.validator_id = svs.id
    LEFT JOIN at_window w ON w.validator_id = svs.id
    CROSS JOIN win
  `
    .execute(pindexerDb)
    .catch(degrade('validator chain snapshots', null));

  const snapshots = new Map<string, ValidatorChainSnapshot>();
  if (!result) {
    return snapshots;
  }

  for (const row of result.rows) {
    let realizedApyPct: number | null = null;
    let windowDays: number | null = null;

    const to = row.rate_bps2 === null ? null : Number(row.rate_bps2) / BPS_SQUARED;
    const from =
      row.from_rate_bps2 === null ? null : Number(row.from_rate_bps2) / BPS_SQUARED;
    if (from !== null && to !== null && from > 0 && to > 0 && row.t0 && row.t1) {
      const days = (new Date(row.t1).getTime() - new Date(row.t0).getTime()) / 86_400_000;
      if (days >= MIN_WINDOW_DAYS) {
        windowDays = days;
        realizedApyPct = (to / from - 1) * (365 / days) * 100;
      }
    }

    snapshots.set(row.ik, {
      state: stateLabel(row.state ?? ''),
      stakeUM: Number(row.stake_um ?? 0) / UM_UNIT,
      realizedApyPct,
      windowDays,
    });
  }

  return snapshots;
}

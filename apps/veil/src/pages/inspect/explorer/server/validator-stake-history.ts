'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';

const UM_UNIT = 1_000_000;
const toUM = (raw: bigint | number | string | null | undefined): number =>
  raw === null || raw === undefined ? 0 : Number(raw) / UM_UNIT;

export interface ValidatorStakeFlowPoint {
  date: string;
  /** End-of-day UM staked to this validator. */
  stake: number;
  /** Total UM delegated to this validator that day. */
  delegated: number;
  /** Total UM undelegated from this validator that day. */
  undelegated: number;
  netFlow: number;
}

interface DateUmRow {
  date: string;
  um: bigint;
}

interface DateAmountRow {
  date: string;
  amount: bigint;
}

/**
 * Per-day stake + delegation/undelegation flows for a single validator.
 *
 * Mirrors the aggregate fetcher in active-stake-history.ts but joins on the
 * validator's identity key (`ik` in pindexer's stake tables, mapped through
 * `stake_validator_set.id` for the per-block staked-supply table).
 */
export async function fetchValidatorStakeHistory(
  identityKey: string,
  days = 90,
): Promise<ValidatorStakeFlowPoint[]> {
  const since = new Date(Date.now() - days * 86_400 * 1000);

  const [stakeRows, delegationRows, undelegationRows] = await Promise.all([
    sql<DateUmRow>`
      WITH validator AS (
        SELECT id FROM stake_validator_set WHERE ik = ${identityKey} LIMIT 1
      )
      SELECT
        to_char(date_trunc('day', bd.timestamp), 'YYYY-MM-DD') AS date,
        MAX(sts.um)::bigint AS um
      FROM supply_total_staked sts
      JOIN block_details bd ON bd.height = sts.height
      JOIN validator v ON v.id = sts.validator_id
      WHERE bd.timestamp >= ${since}
      GROUP BY date_trunc('day', bd.timestamp)
      ORDER BY date ASC
    `.execute(pindexerDb),

    sql<DateAmountRow>`
      SELECT
        to_char(date_trunc('day', bd.timestamp), 'YYYY-MM-DD') AS date,
        SUM(txs.amount)::bigint AS amount
      FROM stake_delegation_txs txs
      JOIN block_details bd ON bd.height = txs.height
      WHERE txs.ik = ${identityKey} AND bd.timestamp >= ${since}
      GROUP BY date_trunc('day', bd.timestamp)
      ORDER BY date ASC
    `.execute(pindexerDb),

    sql<DateAmountRow>`
      SELECT
        to_char(date_trunc('day', bd.timestamp), 'YYYY-MM-DD') AS date,
        SUM(txs.amount)::bigint AS amount
      FROM stake_undelegation_txs txs
      JOIN block_details bd ON bd.height = txs.height
      WHERE txs.ik = ${identityKey} AND bd.timestamp >= ${since}
      GROUP BY date_trunc('day', bd.timestamp)
      ORDER BY date ASC
    `.execute(pindexerDb),
  ]);

  const byDate = new Map<string, ValidatorStakeFlowPoint>();
  const ensure = (date: string): ValidatorStakeFlowPoint => {
    const existing = byDate.get(date);
    if (existing) {
      return existing;
    }
    const created: ValidatorStakeFlowPoint = {
      date,
      stake: 0,
      delegated: 0,
      undelegated: 0,
      netFlow: 0,
    };
    byDate.set(date, created);
    return created;
  };

  for (const r of stakeRows.rows) {
    ensure(r.date).stake = toUM(r.um);
  }
  for (const r of delegationRows.rows) {
    ensure(r.date).delegated = toUM(r.amount);
  }
  for (const r of undelegationRows.rows) {
    ensure(r.date).undelegated = toUM(r.amount);
  }
  for (const e of byDate.values()) {
    e.netFlow = e.delegated - e.undelegated;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';
import { degrade } from './degrade';

const UM_UNIT = 1_000_000;
const toUM = (raw: bigint | number | string | null | undefined): number =>
  raw === null || raw === undefined ? 0 : Number(raw) / UM_UNIT;

export interface ValidatorStakeDeltas {
  /** Current UM staked. */
  current: number;
  /** Current − stake N days ago. UM. Positive = gained stake. */
  delta7d: number;
  delta30d: number;
}

interface IkUmRow {
  ik: string;
  um: bigint | null;
}

/**
 * For each validator in stake_validator_set, compute current stake and the
 * stake N days ago for N ∈ {7, 30}, then return the deltas keyed by identity
 * key. "Stake at time T" is the most recent supply_total_staked.um row at or
 * before T; "current" is the latest row overall. Validators with no stake
 * row before T (e.g. created after) get 0 for that historical baseline, so
 * their delta == current — new validators surface to the top of the growth
 * ranking, which is the whole point.
 */
export async function fetchValidatorStakeDeltas(): Promise<Map<string, ValidatorStakeDeltas>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400 * 1000);

  // See degrade.ts: a pindexer outage must not reject into the RSC render.
  const rows = await Promise.all([
    sql<IkUmRow>`
      SELECT
        svs.ik AS ik,
        (
          SELECT sts.um
          FROM supply_total_staked sts
          WHERE sts.validator_id = svs.id
          ORDER BY sts.height DESC
          LIMIT 1
        )::bigint AS um
      FROM stake_validator_set svs
    `.execute(pindexerDb),

    sql<IkUmRow>`
      SELECT
        svs.ik AS ik,
        (
          SELECT sts.um
          FROM supply_total_staked sts
          JOIN block_details bd ON bd.height = sts.height
          WHERE sts.validator_id = svs.id AND bd.timestamp <= ${sevenDaysAgo}
          ORDER BY sts.height DESC
          LIMIT 1
        )::bigint AS um
      FROM stake_validator_set svs
    `.execute(pindexerDb),

    sql<IkUmRow>`
      SELECT
        svs.ik AS ik,
        (
          SELECT sts.um
          FROM supply_total_staked sts
          JOIN block_details bd ON bd.height = sts.height
          WHERE sts.validator_id = svs.id AND bd.timestamp <= ${thirtyDaysAgo}
          ORDER BY sts.height DESC
          LIMIT 1
        )::bigint AS um
      FROM stake_validator_set svs
    `.execute(pindexerDb),
  ]).catch(degrade('stake deltas', null));

  if (!rows) {
    return new Map();
  }
  const [currentRows, sevenRows, thirtyRows] = rows;

  const sevenByIk = new Map<string, number>();
  for (const r of sevenRows.rows) {
    sevenByIk.set(r.ik, toUM(r.um));
  }
  const thirtyByIk = new Map<string, number>();
  for (const r of thirtyRows.rows) {
    thirtyByIk.set(r.ik, toUM(r.um));
  }

  const out = new Map<string, ValidatorStakeDeltas>();
  for (const r of currentRows.rows) {
    const current = toUM(r.um);
    out.set(r.ik, {
      current,
      delta7d: current - (sevenByIk.get(r.ik) ?? 0),
      delta30d: current - (thirtyByIk.get(r.ik) ?? 0),
    });
  }
  return out;
}

'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';
import { degrade } from './degrade';

export interface ValidatorSlashing {
  height: number;
  epoch: number;
  /** Penalty as the raw bps^2 string (e.g. "10000000" ~= 0.01%). */
  penalty: string;
  timestamp: string;
}

interface SlashingRow {
  height: bigint;
  epoch_index: bigint;
  penalty: string;
  timestamp: Date;
}

/**
 * Slashing events recorded against a validator. Pindexer's `stake_slashings`
 * is append-only — each row is one consensus violation that produced a
 * penalty. There's no jail-event table, so we surface slashings as the proxy
 * for "something went wrong here" and rely on the live `validator_state`
 * for the current jailed/tombstoned status.
 */
export async function fetchValidatorSlashings(
  identityKey: string,
  limit = 50,
): Promise<ValidatorSlashing[]> {
  const result = await sql<SlashingRow>`
    SELECT
      s.height,
      s.epoch_index,
      s.penalty,
      bd.timestamp
    FROM stake_slashings s
    JOIN block_details bd ON bd.height = s.height
    WHERE s.ik = ${identityKey}
    ORDER BY s.height DESC
    LIMIT ${limit}
  `
    .execute(pindexerDb)
    .catch(degrade('slashings', null));

  if (!result) {
    return [];
  }

  return result.rows.map(r => ({
    height: Number(r.height),
    epoch: Number(r.epoch_index),
    penalty: r.penalty,
    timestamp: r.timestamp.toISOString(),
  }));
}

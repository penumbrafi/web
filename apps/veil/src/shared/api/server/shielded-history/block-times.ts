import { pindexerDb } from '@/shared/database/client';

// Postgres caps a statement at 65535 bind parameters.
const HEIGHT_CHUNK = 10_000;

// Block times never change, so every height ever looked up stays cached.
// Bounded by the number of distinct heights in insights_shielded_pool.
const blockTimes = new Map<number, number>();

/** Block time (ms) of each height, from block_details; heights missing there are absent. */
export const timesFor = async (heights: number[]): Promise<Map<number, number>> => {
  const missing = heights.filter(h => !blockTimes.has(h));
  for (let i = 0; i < missing.length; i += HEIGHT_CHUNK) {
    const rows = await pindexerDb
      .selectFrom('block_details')
      .select(['height', 'timestamp'])
      .where('height', 'in', missing.slice(i, i + HEIGHT_CHUNK).map(String))
      .execute();
    for (const r of rows) {
      blockTimes.set(Number(r.height), new Date(r.timestamp).getTime());
    }
  }
  return blockTimes;
};

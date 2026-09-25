import fs from 'fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema';

/** Thrown when the indexer cannot be reached (or is not configured at all). */
export class IndexerUnavailableError extends Error {
  override readonly name = 'IndexerUnavailableError';
}

// int8 -> BigInt. Heights and supply totals fit in a double today, but the
// parser is global to `pg` and keeping BigInt end-to-end is what veil does.
const int8TypeId = 20;
types.setTypeParser(int8TypeId, val => BigInt(val));

let db: Kysely<DB> | undefined;

/**
 * Lazily constructed Kysely client for the pindexer database. Nothing
 * connects at import time, so `next build` (no database in CI) and the
 * health-checked `/` route never touch Postgres. A missing endpoint or a
 * dead host surfaces as `IndexerUnavailableError` within a few seconds
 * rather than a hung request: `pg` has no default connection timeout.
 */
export const getPindexerDb = (): Kysely<DB> => {
  if (db) {
    return db;
  }
  const connectionString = process.env['PENUMBRA_INDEXER_ENDPOINT'];
  if (!connectionString) {
    throw new IndexerUnavailableError('PENUMBRA_INDEXER_ENDPOINT is not set');
  }
  const ca = process.env['PENUMBRA_INDEXER_CA_CERT'];
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 60_000,
    statement_timeout: 30_000,
    ...(ca && {
      ssl: {
        rejectUnauthorized: true,
        ca: ca.startsWith('-----BEGIN CERTIFICATE-----') ? ca : fs.readFileSync(ca, 'utf-8'),
      },
    }),
  });
  // A dropped idle connection emits on the pool; without a listener that is
  // an uncaught exception that takes the server down.
  pool.on('error', err => {
    console.error('pindexer pool error', err);
  });
  db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return db;
};

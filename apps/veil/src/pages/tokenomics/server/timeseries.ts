'use server';

import { sql } from 'kysely';
import { pindexerDb } from '@/shared/database/client';

const UM_UNIT = 1_000_000;
const toUM = (raw: bigint | number | string | null | undefined): number =>
  raw === null || raw === undefined ? 0 : Number(raw) / UM_UNIT;

// Iterate one calendar day at a time from `startDate` to `endDate`
// (inclusive) in UTC, yielding ISO YYYY-MM-DD strings that match how
// pindexer's `date_trunc('day', ...)` labels rows. Using
// setUTCDate(...+1) is DST-safe (no local-time skew across March/Nov)
// and cheaper than parsing new Date() each turn.
function* eachDay(startDate: string, endDate: string): Generator<string> {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  for (
    const cursor = start;
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    yield cursor.toISOString().slice(0, 10);
  }
}

// Turn a sparse daily series (pindexer only emits rows on days with
// blocks — chain outages leave gaps) into a dense one by carrying
// the previous row forward. `synthesize` builds the row for a missing
// day from the last real one; typically that keeps cumulative counters
// steady and zeroes per-day deltas, which is the honest picture of an
// offline period.
function fillDailyGaps<T extends { date: string }>(
  rows: T[],
  synthesize: (prev: T, date: string) => T,
): T[] {
  const [first, ...rest] = rows;
  if (!first) {return rows;}
  const out: T[] = [];
  let prev = first;
  out.push(prev);
  for (const next of rest) {
    let gapStarted = false;
    for (const day of eachDay(prev.date, next.date)) {
      if (day === prev.date) {continue;} // already pushed
      if (day === next.date) {break;}
      out.push(synthesize(prev, day));
      gapStarted = true;
    }
    void gapStarted; // silence unused when there is no gap
    out.push(next);
    prev = next;
  }
  return out;
}

export interface SupplyPoint {
  date: string; // ISO date, e.g. '2026-04-15'
  total: number; // UM
  staked: number; // UM
}

export interface BurnPoint {
  date: string;
  arb: number;
  fees: number;
  cumulative: number;
}

export interface InflationPoint {
  date: string;
  // Annualized rate computed from a 30d trailing supply change at that point.
  annualizedPct: number;
}

export interface TokenomicsTimeseries {
  supply: SupplyPoint[];
  burns: BurnPoint[];
  inflation: InflationPoint[];
}

/**
 * Fetch daily timeseries for the last `days` days. We bucket on
 * `date_trunc('day', block_details.timestamp)` and pick the max-height row
 * within each bucket. That gives one snapshot per day at end-of-day, which
 * is what the supply/burn/inflation charts want.
 */
export async function fetchTokenomicsTimeseries(
  days = 90,
): Promise<TokenomicsTimeseries> {
  const since = new Date(Date.now() - days * 86_400 * 1000);

  // Daily supply (latest row per UTC day)
  const supplyRows = await pindexerDb
    .selectFrom('insights_supply')
    .innerJoin('block_details', 'block_details.height', 'insights_supply.height')
    .select([
      sql<string>`to_char(date_trunc('day', block_details.timestamp), 'YYYY-MM-DD')`.as('date'),
      sql<bigint>`max(insights_supply.total)`.as('total'),
      sql<bigint>`max(insights_supply.staked)`.as('staked'),
    ])
    .where('block_details.timestamp', '>=', since)
    .groupBy(sql`date_trunc('day', block_details.timestamp)`)
    .orderBy('date', 'asc')
    .execute();

  const rawSupply: SupplyPoint[] = supplyRows.map(r => ({
    date: r.date,
    total: toUM(r.total),
    staked: toUM(r.staked),
  }));
  // Forward-fill missing days. Pindexer only emits an `insights_supply`
  // row per block, so a chain outage or long block gap leaves days
  // absent from the group-by-day result. When we hand those sparse rows
  // to recharts, it linearly interpolates between neighbours — a chain
  // that was offline for four days looks like it was gently deflating
  // for those four days, which is wrong. During a real outage no UM
  // is minted (issuance requires blocks) and no fees or arb are booked,
  // so the honest series carries the previous values forward.
  const supply = fillDailyGaps(rawSupply, (prev, date) => ({
    date,
    total: prev.total,
    staked: prev.staked,
  }));

  // Cumulative burns per day. supply_total_unstaked has running totals;
  // pick the max-height row per day, then compute daily delta in code.
  const burnRows = await pindexerDb
    .selectFrom('supply_total_unstaked')
    .innerJoin('block_details', 'block_details.height', 'supply_total_unstaked.height')
    .select([
      sql<string>`to_char(date_trunc('day', block_details.timestamp), 'YYYY-MM-DD')`.as('date'),
      sql<bigint>`max(supply_total_unstaked.arb)`.as('arb'),
      sql<bigint>`max(supply_total_unstaked.fees)`.as('fees'),
    ])
    .where('block_details.timestamp', '>=', since)
    .groupBy(sql`date_trunc('day', block_details.timestamp)`)
    .orderBy('date', 'asc')
    .execute();

  // Forward-fill first so a chain outage doesn't dump the entire
  // gap's accumulated burns onto the first post-outage day (the
  // counters are monotonic, so a delta computed across a 5-day gap
  // would attribute five days of burns to one row and read as a
  // spike). With per-day forward-fill each missing day carries the
  // previous cumulative values, so its own delta is zero.
  const filledBurnRows = fillDailyGaps(
    burnRows.map(r => ({
      date: r.date,
      arb: toUM(r.arb),
      fees: Math.abs(toUM(r.fees)),
    })),
    (prev, date) => ({ date, arb: prev.arb, fees: prev.fees }),
  );

  const burns: BurnPoint[] = [];
  let prevArb: number | null = null;
  let prevFees: number | null = null;
  for (const r of filledBurnRows) {
    const arbCum = r.arb;
    const feeCum = r.fees;
    const arbDelta = prevArb === null ? 0 : Math.max(0, arbCum - prevArb);
    const feeDelta = prevFees === null ? 0 : Math.max(0, feeCum - prevFees);
    prevArb = arbCum;
    prevFees = feeCum;
    burns.push({
      date: r.date,
      arb: arbDelta,
      fees: feeDelta,
      cumulative: arbCum + feeCum,
    });
  }

  // Trailing 30d annualized inflation per day from the supply curve.
  const inflation: InflationPoint[] = [];
  for (const [i, cur] of supply.entries()) {
    // Find the supply point ~30 days before; skip days without one.
    let past: (typeof supply)[number] | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = supply[j];
      if (!candidate) {continue;}
      const dDays =
        (Date.parse(cur.date) - Date.parse(candidate.date)) / (1000 * 86_400);
      if (dDays >= 30) {
        past = candidate;
        break;
      }
    }
    if (!past) {continue;}
    if (past.total <= 0) {continue;}
    const dDays =
      (Date.parse(cur.date) - Date.parse(past.date)) / (1000 * 86_400);
    if (dDays <= 0) {continue;}
    const windowPct = ((cur.total - past.total) / past.total) * 100;
    inflation.push({
      date: cur.date,
      annualizedPct: windowPct * (365 / dDays),
    });
  }

  return { supply, burns, inflation };
}

'use server';

import { sql } from 'kysely';
import { unstable_cache } from 'next/cache';
import { pindexerDb } from '@/shared/database/client';

const UM_UNIT = 1_000_000;
const toUM = (raw: bigint | number | string | null | undefined): number =>
  raw === null || raw === undefined ? 0 : Number(raw) / UM_UNIT;

const FLOWS_TOP_N = 5;

export interface ValidatorFlow {
  /** Resolved validator name, falling back to ik if pindexer has no entry. */
  name: string;
  /** UM delegated to this validator in this bucket. */
  delegated: number;
  /** UM undelegated from this validator in this bucket. */
  undelegated: number;
}

export interface ActiveStakeFlowPoint {
  date: string; // ISO date (bucket start)
  /** Sum of delegations to currently-active validators at end-of-bucket. UM. */
  activeStake: number;
  /** Sum of delegations to bonded-but-not-active validators (JAILED /
   *  DISABLED / DEFINED — excludes TOMBSTONED which is slashed). UM. */
  inactiveStake: number;
  /** Total UM supply at end-of-bucket, from insights_supply. */
  totalSupply: number;
  /** Total amount delegated during this bucket. UM. */
  delegated: number;
  /** Total amount undelegated during this bucket. UM. */
  undelegated: number;
  /** delegated - undelegated. UM. */
  netFlow: number;
  /** Top contributors to this bucket's flows, by |delegated|+|undelegated|. */
  validatorFlows: ValidatorFlow[];
}

interface PerBucketRow {
  date: string;
  bucket: 'active' | 'inactive';
  um: bigint;
}

interface SupplyBucketRow {
  date: string;
  supply: bigint | null;
}

interface BucketValidatorRow {
  date: string;
  ik: string;
  name: string;
  amount: bigint;
}

/**
 * Per-bucket bonded-stake snapshots + delegation/undelegation flows, with the
 * top validators that drove each bucket's flow.
 *
 * Buckets are `stepDays` wide. With stepDays=1 each row is a calendar day;
 * larger steps aggregate flows and sparsen the stake snapshots to keep the
 * cost manageable for long windows. The chart picks step values such that
 * every window stays in the 25–200 point range — fine enough that the line
 * still reads as continuous, coarse enough that the per-validator LATERAL
 * lookup count stays sane (90K lookups at daily/2y was timing out >60s).
 *
 * Active stake here = sum of supply_total_staked.um for validators that are
 * *currently* in the ACTIVE state. Pindexer's stake_validator_set table only
 * holds the latest validator state (no per-height history), so we make the
 * defensible approximation that membership in the active set has been stable
 * over the chart window. For 30–90 day windows this is mostly true on
 * Penumbra mainnet — validator churn is slow.
 *
 * supply_total_staked only writes a row when a validator's stake changes,
 * so for any given bucket many validators have no row at all. The stake
 * query must therefore carry forward each validator's last known um value
 * rather than reading the bucket's rows directly — otherwise quiet buckets
 * collapse to near-zero and the chart looks broken.
 */
async function fetchActiveStakeHistoryUncached(
  days: number,
  stepDays: number,
): Promise<ActiveStakeFlowPoint[]> {
  const since = new Date(Date.now() - days * 86_400 * 1000);

  const [stakeRows, delegationRows, undelegationRows, supplyRows] = await Promise.all([
    sql<PerBucketRow>`
      WITH bonded_validators AS (
        SELECT
          id,
          CASE
            WHEN validator_state::jsonb->>'state' = 'VALIDATOR_STATE_ENUM_ACTIVE'
              THEN 'active'
            WHEN validator_state::jsonb->>'state' IN (
              'VALIDATOR_STATE_ENUM_JAILED',
              'VALIDATOR_STATE_ENUM_DISABLED',
              'VALIDATOR_STATE_ENUM_DEFINED'
            ) THEN 'inactive'
            ELSE NULL
          END AS bucket
        FROM stake_validator_set
        WHERE validator_state::jsonb->>'state' IN (
          'VALIDATOR_STATE_ENUM_ACTIVE',
          'VALIDATOR_STATE_ENUM_JAILED',
          'VALIDATOR_STATE_ENUM_DISABLED',
          'VALIDATOR_STATE_ENUM_DEFINED'
        )
      ),
      step AS (
        SELECT (interval '1 day' * ${stepDays}) AS dur,
               date_trunc('day', ${since}::timestamp) AS anchor
      ),
      buckets AS (
        SELECT generate_series(
          (SELECT anchor FROM step),
          date_trunc('day', now()),
          (SELECT dur FROM step)
        ) AS bucket_start
      )
      SELECT
        to_char(b.bucket_start, 'YYYY-MM-DD') AS date,
        bv.bucket AS bucket,
        COALESCE(SUM(last_um.um), 0)::bigint AS um
      FROM buckets b
      CROSS JOIN bonded_validators bv
      LEFT JOIN LATERAL (
        SELECT sts.um
        FROM supply_total_staked sts
        JOIN block_details bd ON bd.height = sts.height
        WHERE sts.validator_id = bv.id
          AND bd.timestamp < b.bucket_start + (SELECT dur FROM step)
        ORDER BY bd.height DESC
        LIMIT 1
      ) last_um ON true
      GROUP BY b.bucket_start, bv.bucket
      ORDER BY b.bucket_start ASC, bv.bucket
    `.execute(pindexerDb),

    sql<BucketValidatorRow>`
      SELECT
        to_char(
          date_bin(
            interval '1 day' * ${stepDays},
            bd.timestamp,
            date_trunc('day', ${since}::timestamp)
          ),
          'YYYY-MM-DD'
        ) AS date,
        txs.ik AS ik,
        COALESCE(vs.name, txs.ik) AS name,
        SUM(txs.amount)::bigint AS amount
      FROM stake_delegation_txs txs
      JOIN block_details bd ON bd.height = txs.height
      LEFT JOIN stake_validator_set vs ON vs.ik = txs.ik
      WHERE bd.timestamp >= ${since}
      GROUP BY 1, txs.ik, vs.name
      ORDER BY 1 ASC, amount DESC
    `.execute(pindexerDb),

    sql<BucketValidatorRow>`
      SELECT
        to_char(
          date_bin(
            interval '1 day' * ${stepDays},
            bd.timestamp,
            date_trunc('day', ${since}::timestamp)
          ),
          'YYYY-MM-DD'
        ) AS date,
        txs.ik AS ik,
        COALESCE(vs.name, txs.ik) AS name,
        SUM(txs.amount)::bigint AS amount
      FROM stake_undelegation_txs txs
      JOIN block_details bd ON bd.height = txs.height
      LEFT JOIN stake_validator_set vs ON vs.ik = txs.ik
      WHERE bd.timestamp >= ${since}
      GROUP BY 1, txs.ik, vs.name
      ORDER BY 1 ASC, amount DESC
    `.execute(pindexerDb),

    // insights_supply has ~one row per block (10M+ rows). The naive LATERAL
    // (scan by height DESC, JOIN block_details, filter timestamp, LIMIT 1)
    // is O(blocks-since-bucket-end) per bucket — fine for "today" but a
    // ~8M-row scan for buckets 2 years back, even with both PKs. Without a
    // block_details(timestamp) index we can't make that fast directly.
    //
    // Workaround: convert the bucket-end timestamp into an *approximate*
    // chain height using a fixed ~6s block time, then do a single PK
    // lookup on insights_supply. Supply changes slowly (no per-second
    // delta), so a few-minute approximation against the true bucket-end
    // height is invisible in the chart.
    sql<SupplyBucketRow>`
      WITH chain_tip AS (
        -- instant: max(height) is the rightmost leaf of the PK btree
        SELECT max(height) AS h FROM block_details
      ),
      step AS (
        SELECT (interval '1 day' * ${stepDays}) AS dur,
               date_trunc('day', ${since}::timestamp) AS anchor
      ),
      buckets AS (
        SELECT generate_series(
          (SELECT anchor FROM step),
          date_trunc('day', now()),
          (SELECT dur FROM step)
        ) AS bucket_start
      )
      SELECT
        to_char(b.bucket_start, 'YYYY-MM-DD') AS date,
        ins.total AS supply
      FROM buckets b
      CROSS JOIN chain_tip ct
      -- Clamp to [0, chain_tip]: future-bucket-ends use current supply,
      -- pre-genesis dates fall off the table and yield NULL.
      LEFT JOIN insights_supply ins ON ins.height = LEAST(
        ct.h,
        GREATEST(
          ct.h - FLOOR(EXTRACT(epoch FROM (
            now() - (b.bucket_start + (SELECT dur FROM step))
          )) / 6)::bigint,
          0
        )
      )
      ORDER BY b.bucket_start ASC
    `.execute(pindexerDb),
  ]);

  const byDate = new Map<string, ActiveStakeFlowPoint>();
  const flowsByDate = new Map<string, Map<string, ValidatorFlow & { ik: string }>>();

  const point = (date: string): ActiveStakeFlowPoint => {
    let e = byDate.get(date);
    if (!e) {
      e = {
        date,
        activeStake: 0,
        inactiveStake: 0,
        totalSupply: 0,
        delegated: 0,
        undelegated: 0,
        netFlow: 0,
        validatorFlows: [],
      };
      byDate.set(date, e);
    }
    return e;
  };

  const flowFor = (date: string, ik: string, name: string): ValidatorFlow & { ik: string } => {
    let day = flowsByDate.get(date);
    if (!day) {
      day = new Map();
      flowsByDate.set(date, day);
    }
    let v = day.get(ik);
    if (!v) {
      v = { ik, name, delegated: 0, undelegated: 0 };
      day.set(ik, v);
    }
    return v;
  };

  for (const r of stakeRows.rows) {
    const p = point(r.date);
    if (r.bucket === 'active') {p.activeStake = toUM(r.um);}
    else if (r.bucket === 'inactive') {p.inactiveStake = toUM(r.um);}
  }
  for (const r of supplyRows.rows) {
    point(r.date).totalSupply = toUM(r.supply);
  }
  for (const r of delegationRows.rows) {
    const um = toUM(r.amount);
    const p = point(r.date);
    p.delegated += um;
    flowFor(r.date, r.ik, r.name).delegated += um;
  }
  for (const r of undelegationRows.rows) {
    const um = toUM(r.amount);
    const p = point(r.date);
    p.undelegated += um;
    flowFor(r.date, r.ik, r.name).undelegated += um;
  }
  for (const [date, day] of flowsByDate) {
    const top = Array.from(day.values())
      .sort((a, b) =>
        Math.abs(b.delegated) + Math.abs(b.undelegated)
        - (Math.abs(a.delegated) + Math.abs(a.undelegated)),
      )
      .slice(0, FLOWS_TOP_N)
      .map(({ name, delegated, undelegated }) => ({ name, delegated, undelegated }));
    point(date).validatorFlows = top;
  }
  for (const e of byDate.values()) {
    e.netFlow = e.delegated - e.undelegated;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 30-minute server-side cache. Penumbra mainnet ticks epoch boundaries roughly
 * once per day, so a half-hour TTL costs ~nothing on freshness and saves every
 * visitor past the first the full LATERAL round-trip.
 *
 * Keyed on (days, stepDays) so each (window × density) gets its own slot —
 * the coarse-then-dense progressive pattern below relies on this.
 */
export const fetchActiveStakeHistory = unstable_cache(
  fetchActiveStakeHistoryUncached,
  ['active-stake-history-v2'],
  { revalidate: 1800 },
);


'use server';

import { sql } from 'kysely';
import { identityKeyFromBech32m } from '@penumbra-zone/bech32m/penumbravalid';
import { QueryService as StakeQueryService } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_connect';
import {
  ValidatorState_ValidatorStateEnum,
  type ValidatorInfo,
} from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { pindexerDb } from '@/shared/database/client';
import { createClient } from '@/shared/utils/protos/utils';

// What delegators are actually paid.
//
// The staking budget is fixed, but the budget is not what a delegator earns.
// Each validator quotes its own per-epoch rate in
// `rate_data.validator_reward_rate` (stake component, refreshed at every epoch
// boundary) and keeps a commission off the top through its funding streams. A
// validator that routes 10_000 bps to itself or to the community pool pays its
// delegators nothing, however fat the network budget is; a validator with a 1%
// commission pays out nearly the whole pre-commission rate.
//
// Reading both straight off the chain per active validator gives two numbers
// the pre-commission headline cannot:
//   net APY ≈ validator_reward_rate × epochs/year        (already net)
//   Σ(power × rate) / Σ(power) × epochs/year             (power-weighted)
// and the power-weighted commission is exactly the share of the staking budget
// that never reaches a delegator.
//
// Cache 1h: rates only move at an epoch boundary (~2.4 days) and commissions
// only on validator definition transactions.

export interface ValidatorYield {
  // bech32m identity key. The explorer's validator GraphQL exposes the same
  // string as `id`, so per-validator pages can join on it directly.
  ik: string;
  name: string;
  powerUM: number;
  commissionBps: number;
  // The chain's own per-epoch reward rate for this validator, annualized
  // linearly (matches how the page annualizes the network budget).
  netApyPct: number;
}

export interface ActiveSetYields {
  validators: ValidatorYield[];
  powerUM: number;
  // Power-weighted net APY: what an average actively-bonded UM earns.
  weightedNetApyPct: number;
  // Best active validator (lowest commission) — the practical ceiling.
  maxNetApyPct: number;
  // Worst active validator (commission routing everything away) — 0 when a
  // validator sends all of its rewards to itself or to the community pool.
  minNetApyPct: number;
  minCommissionBps: number;
  // Power-weighted commission == share of the issuance budget paid as
  // commission instead of to delegators.
  weightedCommissionBps: number;
  largest: ValidatorYield | null;
  fetchedAt: Date;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const RPC_TIMEOUT_MS = 8_000;
// The active set is bounded by `active_validator_limit` (a few dozen in
// practice); cap the fan-out anyway.
const MAX_VALIDATORS = 64;
const BPS_SQUARED_SCALING_FACTOR = 100_000_000; // num.Amount scale for rate values
const UM_UNIT = 1_000_000;

interface ActiveValidatorRow {
  ik: string;
  voting_power: bigint;
}

let cached: ActiveSetYields | null = null;
let cachedEpochsPerYear = 0;
let cachedInflightAt = 0;

const activeValidatorKeys = async (): Promise<ActiveValidatorRow[]> => {
  const res = await sql<ActiveValidatorRow>`
    SELECT svs.ik AS ik, svs.voting_power::bigint AS voting_power
    FROM stake_validator_set svs
    WHERE svs.validator_state::jsonb->>'state' = 'VALIDATOR_STATE_ENUM_ACTIVE'
    ORDER BY svs.voting_power DESC
    LIMIT ${MAX_VALIDATORS}
  `.execute(pindexerDb);
  return res.rows;
};

// num.Amount is a U128x128 carrying lo/hi 64-bit halves.
const TWO_POW_64 = 2n ** 64n;
const rawAmount = (amount?: { lo?: bigint; hi?: bigint }): bigint =>
  amount ? (amount.lo ?? 0n) + (amount.hi ?? 0n) * TWO_POW_64 : 0n;

// Commission is the sum of the validator's funding-stream rates: whichever
// recipient (itself or the community pool) the streams point at, that share of
// the rewards never reaches a delegator.
const commissionBps = (info: ValidatorInfo): number =>
  (info.validator?.fundingStreams ?? []).reduce((sum, stream) => {
    const recipient = stream.recipient.value as { rateBps?: number } | undefined;
    return sum + (recipient?.rateBps ?? 0);
  }, 0);

/**
 * Per-validator realized yields for the current active set. Returns null when
 * the chain endpoint is unreachable (or has never answered), so callers can
 * fall back to the pre-commission view.
 */
export async function fetchActiveSetYields(
  epochsPerYear: number,
): Promise<ActiveSetYields | null> {
  if (!Number.isFinite(epochsPerYear) || epochsPerYear <= 0) {
    return null;
  }
  const now = Date.now();
  if (
    cached &&
    cachedEpochsPerYear === epochsPerYear &&
    now - cached.fetchedAt.getTime() < CACHE_TTL_MS
  ) {
    return cached;
  }
  // Avoid stampede: one in-flight refresh per instance.
  if (now - cachedInflightAt < 5_000) {
    return cached;
  }
  cachedInflightAt = now;

  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  if (!grpcEndpoint) {
    return cached;
  }

  try {
    const rows = await activeValidatorKeys();
    if (!rows.length) {
      return cached;
    }
    const client = createClient(grpcEndpoint, StakeQueryService);
    const fetched = await Promise.race([
      Promise.all(
        rows.map(async (row): Promise<ValidatorYield | null> => {
          const res = await client
            .getValidatorInfo({ identityKey: identityKeyFromBech32m(row.ik) })
            .catch(() => undefined);
          const info = res?.validatorInfo;
          if (!info) {
            return null;
          }
          const status = info.status;
          // The DB set can lag a state change by a block; trust the chain.
          if (status?.state?.state !== ValidatorState_ValidatorStateEnum.ACTIVE) {
            return null;
          }
          const chainPowerUM = Number(rawAmount(status.votingPower)) / UM_UNIT;
          const powerUM = chainPowerUM > 0 ? chainPowerUM : Number(row.voting_power) / UM_UNIT;
          const nickname = info.validator?.name.trim() ?? '';
          const ratePerEpoch =
            Number(rawAmount(info.rateData?.validatorRewardRate)) / BPS_SQUARED_SCALING_FACTOR;
          return {
            ik: row.ik,
            name: nickname === '' ? row.ik.slice(0, 24) : nickname,
            powerUM,
            commissionBps: commissionBps(info),
            netApyPct: ratePerEpoch * epochsPerYear * 100,
          };
        }),
      ),
      // AbortController not wired in @connectrpc/connect via `signal` on the
      // options — Promise.race with a timeout is the portable fallback.
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT_MS);
      }),
    ]);

    const validators = fetched
      .filter((v): v is ValidatorYield => v !== null)
      .sort((a, b) => b.powerUM - a.powerUM);
    // Power is the weight for every aggregate below; without it there is no
    // meaningful average.
    const powerUM = validators.reduce((sum, v) => sum + v.powerUM, 0);
    if (!validators.length || powerUM <= 0) {
      return cached;
    }
    const weighted = (pick: (v: ValidatorYield) => number) =>
      validators.reduce((sum, v) => sum + v.powerUM * pick(v), 0) / powerUM;

    cached = {
      validators,
      powerUM,
      weightedNetApyPct: weighted(v => v.netApyPct),
      maxNetApyPct: Math.max(...validators.map(v => v.netApyPct)),
      minNetApyPct: Math.min(...validators.map(v => v.netApyPct)),
      minCommissionBps: Math.min(...validators.map(v => v.commissionBps)),
      weightedCommissionBps: weighted(v => v.commissionBps),
      largest: validators[0] ?? null,
      fetchedAt: new Date(),
    };
    cachedEpochsPerYear = epochsPerYear;
    return cached;
  } catch {
    return cached;
  }
}

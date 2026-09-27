'use server';

import { getValidators } from '@/pages/inspect/explorer/lib/data';
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types';
import { fetchTokenomicsMetrics } from '@/pages/tokenomics/server/metrics';
import { fetchValidatorChainSnapshots } from './validator-chain-snapshot';

// Per-validator yields for the validator pages.
//
// The network mints a FIXED staking budget: the same UM per block whether 2% or
// 80% of the supply is bonded. So a delegator's APY is not a network-wide rate
// — it is whether their validator is in the active set at all, times that
// validator's commission:
//
//     netApy = active ? stakingApyPct x (1 - commission) : 0
//
// which is what the table's "Est. APY" column shows, per validator. The
// realized companion number comes from pindexer (see validator-chain-snapshot):
// the measured growth of the delegation-token exchange rate, which already has
// commission and jailing baked in. The two disagree when a validator was jailed
// inside the window or the base rate moved, and that difference is the point.
//
// The inflation side is the same realized figure the tokenomics page publishes
// (30d supply growth, annualized, net of burns), so the two pages cannot drift
// apart.

const ACTIVE = 'ACTIVE';

const stateLabel = (raw: string): string =>
  raw.replace(/^VALIDATOR_STATE_ENUM_/, '').toUpperCase();

export interface ValidatorYieldRow {
  commissionBps: number;
  /** 'ACTIVE' | 'JAILED' | 'DISABLED' | 'TOMBSTONED' | 'DEFINED' | 'UNBONDING'. */
  state: string;
  /** Only active validators earn staking issuance; the rest pay their delegators 0. */
  active: boolean;
  /** Net APY for a delegator, after this validator's commission. 0 outside the active set. */
  netApyPct: number;
  /** netApyPct - inflationPct: yearly gain over holding UM unstaked. */
  realYieldPct: number;
  /** Measured exchange-rate growth (30d, annualized), in percent. NULL when unmeasurable. */
  realizedApyPct: number | null;
  /** Days actually measured behind realizedApyPct. NULL when unmeasurable. */
  windowDays: number | null;
}

export interface ValidatorYieldBoard {
  byKey: Record<string, ValidatorYieldRow>;
  /** Bonded stake sitting on active validators — the only stake that earns. */
  activePowerUM: number;
  /** Bonded stake on jailed/disabled/tombstoned validators: earns nothing, dilutes the rest. */
  inactivePowerUM: number;
  totalPowerUM: number;
  activeSharePct: number;
  activeCount: number;
  totalCount: number;
  /** Power-weighted net APY across the active set — what an average active delegation earns. */
  weightedNetApyPct: number;
  /** Same average taken over ALL bonded stake, inactive validators' zeros included. */
  bondedNetApyPct: number;
  /** Realized supply growth (30d, annualized, net of burns), in percent. */
  inflationPct: number;
}

/**
 * Yields keyed by validator identity key, plus the inflation reference they are
 * compared against. Covers the whole validator set, not just the active one:
 * a validator outside the active set is a real 0% for its delegators, and that
 * is the number the table has to show.
 *
 * NULL only when the chain's validator list itself cannot be read — callers then
 * render the table without the APY column rather than fabricating a number.
 */
export async function fetchValidatorYieldBoard(): Promise<ValidatorYieldBoard | null> {
  // All three are independent reads; the pindexer snapshot degrades to an empty
  // map on its own, in which case the chain's epoch-boundary numbers are used.
  const [metrics, validators, snapshots] = await Promise.all([
    fetchTokenomicsMetrics(),
    getValidators({ state: ValidatorStateFilter.All }),
    fetchValidatorChainSnapshots(),
  ]);

  const baseApyPct = metrics.stakingApyPct;
  const inflationPct = metrics.annualizedInflationPct;
  if (!validators || baseApyPct === null || inflationPct === null) {
    return null;
  }

  const byKey: Record<string, ValidatorYieldRow> = {};
  let activePowerUM = 0;
  let inactivePowerUM = 0;
  let activeCount = 0;
  let weightedNetApyPct = 0;

  for (const validator of validators) {
    const snapshot = snapshots.get(validator.id);
    const state = snapshot?.state ?? stateLabel(String(validator.state));
    const active = state === ACTIVE;
    const commissionPct = Number(validator.commission);
    const powerUM = snapshot?.stakeUM ?? Number(validator.votingPower);
    // Commission is the only thing that makes one active validator pay more
    // than another: the budget is split by stake, not by validator choice.
    const netApyPct = active ? Math.max(0, baseApyPct * (1 - commissionPct / 100)) : 0;

    byKey[validator.id] = {
      commissionBps: Math.round(commissionPct * 100),
      state,
      active,
      netApyPct,
      realYieldPct: netApyPct - inflationPct,
      realizedApyPct: snapshot?.realizedApyPct ?? null,
      windowDays: snapshot?.windowDays ?? null,
    };

    if (active) {
      activePowerUM += powerUM;
      activeCount += 1;
      weightedNetApyPct += powerUM * netApyPct;
    } else {
      inactivePowerUM += powerUM;
    }
  }

  const totalPowerUM = activePowerUM + inactivePowerUM;
  const activeStakeWeighted = activePowerUM > 0 ? weightedNetApyPct / activePowerUM : 0;

  return {
    byKey,
    activePowerUM,
    inactivePowerUM,
    totalPowerUM,
    activeSharePct: totalPowerUM > 0 ? (activePowerUM / totalPowerUM) * 100 : 0,
    activeCount,
    totalCount: validators.length,
    weightedNetApyPct: activeStakeWeighted,
    // Inactive validators are 0% in this average, which is exactly why the
    // network-wide number is far below the active-set one.
    bondedNetApyPct: totalPowerUM > 0 ? weightedNetApyPct / totalPowerUM : 0,
    inflationPct,
  };
}

export interface ValidatorYieldSnapshot {
  /**
   * NULL when the key is not a validator this board knows — it earns no staking
   * issuance for its delegators. A validator outside the active set is NOT
   * null: it is a row with netApyPct 0.
   */
  row: ValidatorYieldRow | null;
  /** Realized supply growth (30d, annualized, net of burns), in percent. */
  inflationPct: number;
}

/**
 * One validator's yield, for the detail page. Reads the same board the list page
 * uses, so the per-validator page does not pay for a second read. NULL when the
 * validator list or pindexer is unreachable — the caller then says the number is
 * unavailable instead of showing zero.
 */
export async function fetchValidatorYield(
  identityKey: string,
): Promise<ValidatorYieldSnapshot | null> {
  const board = await fetchValidatorYieldBoard();
  if (!board) {
    return null;
  }
  return {
    row: board.byKey[identityKey] ?? null,
    inflationPct: board.inflationPct,
  };
}

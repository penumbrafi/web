import { FC } from 'react';
import { formatNumber } from '@/pages/inspect/explorer/lib/utils';
import type { ValidatorYieldBoard } from '@/pages/inspect/explorer/server/validator-yields';

const fmtPct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
const fmtUM = (n: number) => `${formatNumber(n / 1_000_000, 2)}M UM`;

/**
 * One line of APY context above the validator table.
 *
 * The table's per-row APY is that validator's own rate net of its own
 * commission, which is meaningless without the reference point: the network
 * mints a FIXED staking budget, so the return comes from validator selection,
 * not from participation. Two averages follow from that, and they are far
 * apart — the active set earns the budget, and everything bonded to a
 * validator that is not in the active set earns none of it. The comparison
 * that decides whether to stake at all is against holding UM, which earns
 * nothing and is diluted by whatever the supply actually grew by.
 */
export const ValidatorYieldSummary: FC<{ board: ValidatorYieldBoard | null }> = ({ board }) => {
  if (!board) {
    return null;
  }
  const realYieldPct = board.weightedNetApyPct - board.inflationPct;
  const inactiveSharePct = 100 - board.activeSharePct;

  return (
    <p className='max-w-3xl text-sm text-text-secondary'>
      Staking pays a delegator{' '}
      <span className='font-mono text-text-primary'>{fmtPct(board.weightedNetApyPct)}</span> net of
      commission — but only on an active validator ({board.activeCount} of {board.totalCount} hold{' '}
      <span className='font-mono text-text-primary'>{fmtUM(board.activePowerUM)}</span>). Issuance
      is a fixed budget with no APY target, so the other{' '}
      <span className='font-mono text-text-primary'>{fmtUM(board.inactivePowerUM)}</span> (
      {fmtPct(inactiveSharePct, 0)}) bonded to validators that are jailed, disabled or tombstoned
      earns <span className='font-mono text-text-primary'>nothing</span>, and averaged over all{' '}
      {fmtUM(board.totalPowerUM)} bonded the pool is worth{' '}
      <span className='font-mono text-text-primary'>{fmtPct(board.bondedNetApyPct)}</span>/yr.
      Holding UM instead pays nothing and is diluted by{' '}
      <span className='font-mono text-text-primary'>{fmtPct(board.inflationPct)}</span>/yr realized
      inflation, so delegating to an active validator is worth about{' '}
      <span className='font-mono text-text-primary'>+{fmtPct(realYieldPct)}</span>/yr more.
    </p>
  );
};

import { FC } from 'react';
import { Surface } from '@/pages/inspect/explorer/components';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import type { ValidatorYieldSnapshot } from '@/pages/inspect/explorer/server/validator-yields';

const fmtPct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
const signedPct = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

const Tile: FC<{ label: string; note: string; tone?: string; value: string }> = ({
  label,
  note,
  tone,
  value,
}) => (
  <div className='flex flex-col gap-1 rounded-sm border border-other-tonal-fill10 bg-other-tonal-fill5 p-3'>
    <span className='text-xs text-text-secondary'>{label}</span>
    <span className={classNames('font-mono text-xl', tone ?? 'text-text-primary')}>{value}</span>
    <span className='text-xs text-text-secondary'>{note}</span>
  </div>
);

interface Props {
  className?: string;
  /** NULL when the per-validator rates could not be read. */
  snapshot: ValidatorYieldSnapshot | null;
}

/** Explains, for the degenerate cases, why there is no number to show. */
const captionFor = (
  snapshot: ValidatorYieldSnapshot | null,
  row: ValidatorYieldSnapshot['row'],
): string => {
  if (snapshot === null) {
    return 'Per-validator staking rates are unavailable right now.';
  }
  if (row === null) {
    return 'No stake data for this validator yet.';
  }
  if (!row.active) {
    return `This validator is ${row.state.toLowerCase()}, so it is not in the active set: its delegations earn no staking issuance.`;
  }
  return 'Issuance is a fixed budget split across active validators, so this validator&apos;s commission decides what a delegator earns of it.';
};

/**
 * What this validator pays a delegator, on /explore/validators/[id].
 *
 * The tokenomics page publishes network-wide averages; a delegator's actual
 * return is decided by whether their validator is in the active set at all and
 * by its commission, and it is meaningless without the second half of the
 * comparison - the return on NOT staking, i.e. the supply growth that dilutes
 * idle UM. The realized tile is the measured exchange-rate growth, which is the
 * only number here that already includes jailing and commission.
 */
export const ValidatorYieldPanel: FC<Props> = ({ className, snapshot }) => {
  const row = snapshot?.row ?? null;

  return (
    <Surface as='section' className={classNames('flex flex-col gap-4 p-6', className)}>
      <header className='flex flex-col gap-1'>
        <h2 className='text-2xl font-medium'>Rewards</h2>
        <p className='text-sm text-text-secondary'>{captionFor(snapshot, row)}</p>
      </header>

      {row && snapshot && (
        <div className='grid grid-cols-1 gap-3 lg:grid-cols-4 sm:grid-cols-2'>
          <Tile
            label='Est. APY (net)'
            note={
              row.active
                ? `after ${fmtPct(row.commissionBps / 100, 2)} commission`
                : 'not in the active set'
            }
            value={fmtPct(row.netApyPct)}
          />
          <Tile
            label='Realized (30d)'
            note={
              row.realizedApyPct === null
                ? 'no indexed history'
                : `measured over ${Math.round(row.windowDays ?? 0)}d`
            }
            value={row.realizedApyPct === null ? '—' : fmtPct(row.realizedApyPct)}
          />
          <Tile
            label='Real yield'
            note='vs holding UM unstaked'
            tone={row.realYieldPct >= 0 ? 'text-success-light' : 'text-destructive-light'}
            value={signedPct(row.realYieldPct)}
          />
          <Tile
            label='UM inflation'
            note='30d realized, annualized'
            value={fmtPct(snapshot.inflationPct)}
          />
        </div>
      )}
    </Surface>
  );
};

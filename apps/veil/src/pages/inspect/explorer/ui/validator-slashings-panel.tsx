import { FC } from 'react';
import { Surface } from '@/pages/inspect/explorer/components';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import type { ValidatorSlashing } from '../server/validator-slashings';

interface Props {
  className?: string;
  slashings: ValidatorSlashing[];
}

const fmtPenalty = (raw: string): string => {
  const num = Number(raw);
  if (!Number.isFinite(num)) {return raw;}
  return `${(num / 1_000_000).toFixed(4)}%`;
};

const fmtTimestamp = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
  } catch {
    return iso;
  }
};

export const ValidatorSlashingsPanel: FC<Props> = ({ className, slashings }) => (
  <Surface as='section' className={classNames('flex flex-col gap-4 p-6', className)}>
    <header className='flex items-baseline justify-between'>
      <h2 className='text-2xl font-medium'>Slashings</h2>
      <span className='text-sm text-text-secondary'>
        {slashings.length === 0
          ? 'No slashing events'
          : `${slashings.length} event${slashings.length === 1 ? '' : 's'}`}
      </span>
    </header>
    {slashings.length === 0 ? (
      <p className='text-sm text-text-secondary'>
        This validator has no recorded slashing events. Jail and tombstone status,
        when present, are reflected in the validator state above.
      </p>
    ) : (
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-other-tonal-stroke'>
              <th className='pr-4 pb-2 text-left font-medium'>Block</th>
              <th className='pr-4 pb-2 text-left font-medium'>Epoch</th>
              <th className='pr-4 pb-2 text-left font-medium'>Penalty</th>
              <th className='pb-2 text-left font-medium'>Time</th>
            </tr>
          </thead>
          <tbody>
            {slashings.map(s => (
              <tr
                key={`${s.height}-${s.epoch}`}
                className='border-b border-other-tonal-stroke'
              >
                <td className='py-3 pr-4 font-mono'>{s.height.toLocaleString('en-US')}</td>
                <td className='py-3 pr-4 font-mono'>{s.epoch.toLocaleString('en-US')}</td>
                <td className='py-3 pr-4 font-mono text-destructive-light'>
                  {fmtPenalty(s.penalty)}
                </td>
                <td className='py-3 text-text-secondary'>{fmtTimestamp(s.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Surface>
);

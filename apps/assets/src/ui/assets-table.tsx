'use client';

import clsx from 'clsx';
import type { AssetSummary } from '@/lib/api';
import { formatAmount, formatInt, shortId } from './format';

interface Props {
  assets: AssetSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}

const RegistryBadge = ({ inRegistry }: { inRegistry: boolean }) =>
  inRegistry ? (
    <span className='text-xs text-text-secondary'>registry</span>
  ) : (
    <span
      className='rounded-xs border border-caution-light/40 px-1.5 py-0.5 text-xs text-caution-light'
      title='Asset id is not in the bundled registry; amounts may be shown in base units.'
    >
      not in registry
    </span>
  );

/**
 * Every asset with a shielded-pool row, sorted by what is shielded right now.
 * Rows are buttons (keyboard reachable) that select the asset for the chart
 * below; the values here are the table view every chart is also readable
 * from without hovering.
 */
export const AssetsTable = ({ assets, selected, onSelect }: Props) => (
  <div className='overflow-x-auto rounded-md border border-other-tonal-stroke bg-neutral-dark'>
    <table className='w-full text-sm'>
      <thead className='text-left text-xs text-text-secondary'>
        <tr className='border-b border-other-tonal-stroke'>
          <th className='px-4 py-2 font-normal'>Asset</th>
          <th className='px-4 py-2 text-right font-normal'>Shielded now</th>
          <th className='px-4 py-2 text-right font-normal'>Lifetime inflow</th>
          <th className='px-4 py-2 text-right font-normal'>Depositors</th>
          <th className='px-4 py-2 text-right font-normal'>Last change</th>
          <th className='px-4 py-2 font-normal'>Metadata</th>
        </tr>
      </thead>
      <tbody>
        {assets.map(a => {
          const active = a.id === selected;
          return (
            <tr
              key={a.id}
              onClick={() => {
                onSelect(a.id);
              }}
              aria-selected={active}
              className={clsx(
                'cursor-pointer border-b border-other-tonal-stroke/50 last:border-0',
                active ? 'bg-other-tonal-fill10' : 'hover:bg-other-tonal-fill5',
              )}
            >
              <td className='px-4 py-2'>
                <button
                  type='button'
                  onClick={() => {
                    onSelect(a.id);
                  }}
                  className='text-left font-medium text-text-primary'
                  title={a.base}
                >
                  {a.symbol === a.id ? shortId(a.id) : a.symbol}
                </button>
                {a.inRegistry && (
                  <div className='text-xs text-text-secondary' title={a.base}>
                    {a.display}
                  </div>
                )}
                {!a.inRegistry && a.base !== a.id && (
                  <div className='text-xs text-text-secondary'>{a.base}</div>
                )}
              </td>
              <td className='tnum px-4 py-2 text-right'>{formatAmount(a.currentValue)}</td>
              <td className='tnum px-4 py-2 text-right text-text-secondary'>
                {formatAmount(a.totalValue)}
              </td>
              <td className='tnum px-4 py-2 text-right text-text-secondary'>
                {formatInt(a.uniqueDepositors)}
              </td>
              <td className='tnum px-4 py-2 text-right text-text-secondary'>
                {formatInt(a.height)}
              </td>
              <td className='px-4 py-2'>
                <RegistryBadge inRegistry={a.inRegistry} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

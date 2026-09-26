'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { DisplayPosition } from '../model/types';
import { closePositions } from '../api/close-positions';
import { withdrawPositions } from '../api/withdraw-positions';
import { inFlightPositions } from '../api/position-actions-lock';

// Positions per transaction. A close or withdraw of more is split into
// several transactions, signed one after another.
export const ACTIONS_PER_TX = 15;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const txCount = (n: number) => Math.ceil(n / ACTIONS_PER_TX);

/**
 * What the checked rows will do, shown before anything is signed. Replaces
 * "Close Batch (15)", which closed the first 15 rows of whatever sort was
 * active without saying which.
 */
export const SelectionBar = observer(
  ({
    selected,
    matchingCount,
    onSelectAllMatching,
    onClear,
  }: {
    selected: DisplayPosition[];
    /** Positions the current filter shows that can be acted on. */
    matchingCount: number;
    onSelectAllMatching: () => void;
    onClear: () => void;
  }) => {
    const [progress, setProgress] = useState<string>();

    const closeable = selected.filter(p => p.isOpened);
    const withdrawable = selected.filter(p => p.isClosed);
    const busy = progress !== undefined || inFlightPositions.hasAny(selected.map(p => p.idString));

    const run = async (label: string, positions: DisplayPosition[], act: typeof closePositions) => {
      const batches = chunk(
        positions.map(p => ({ id: p.id, position: p.position })),
        ACTIONS_PER_TX,
      );
      try {
        for (const [i, batch] of batches.entries()) {
          setProgress(`${label} ${i + 1} of ${batches.length}…`);
          const result = await act(batch);
          // Stop at the first batch that didn't go through (cancelled in the
          // wallet, busy, or failed); the rest stay selected.
          if (result.status !== 'ok' && result.status !== 'noop') {
            return;
          }
        }
        onClear();
      } finally {
        setProgress(undefined);
      }
    };

    return (
      <div className='col-span-full flex flex-wrap items-center gap-3 rounded-sm bg-other-tonal-fill5 px-3 py-2'>
        <Text small color='text.primary'>
          {selected.length} selected
        </Text>
        {selected.length < matchingCount && (
          <button
            type='button'
            className='text-xs text-primary-light hover:underline'
            onClick={onSelectAllMatching}
          >
            Select all {matchingCount}
          </button>
        )}
        <button
          type='button'
          className='text-xs text-text-secondary hover:underline'
          onClick={onClear}
        >
          Clear
        </button>
        <div className='ml-auto flex items-center gap-2'>
          {progress && (
            <Text detail color='text.secondary'>
              {progress}
            </Text>
          )}
          {closeable.length > 0 && (
            <Button
              density='compact'
              actionType='destructive'
              disabled={busy}
              onClick={() => void run('Closing', closeable, closePositions)}
            >
              {`Close ${closeable.length}${
                txCount(closeable.length) > 1 ? ` (${txCount(closeable.length)} transactions)` : ''
              }`}
            </Button>
          )}
          {withdrawable.length > 0 && (
            <Button
              density='compact'
              actionType='destructive'
              disabled={busy}
              onClick={() => void run('Withdrawing', withdrawable, withdrawPositions)}
            >
              {`Withdraw ${withdrawable.length}${
                txCount(withdrawable.length) > 1
                  ? ` (${txCount(withdrawable.length)} transactions)`
                  : ''
              }`}
            </Button>
          )}
        </div>
      </div>
    );
  },
);

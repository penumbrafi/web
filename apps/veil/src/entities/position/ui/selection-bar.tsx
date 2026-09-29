'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import {
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { DisplayPosition } from '../model/types';
import { closePositions } from '../api/close-positions';
import { withdrawPositions } from '../api/withdraw-positions';
import { fetchPositionsById, updatePositionsQuery } from '../api/use-positions';
import { inFlightPositions } from '../api/position-actions-lock';

// Positions per transaction. A close or withdraw of more is split into
// several transactions, signed one after another.
export const ACTIONS_PER_TX = 15;

// A close is queued in the block that includes it and applied at end of block,
// so the withdraw half of "Remove" waits for the positions to read CLOSED.
const CLOSE_POLL_MS = 3_000;
const CLOSE_WAIT_MS = 120_000;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const txCount = (n: number) => Math.ceil(n / ACTIONS_PER_TX);

const withTxCount = (label: string, n: number) =>
  `${label} ${n}${txCount(n) > 1 ? ` (${txCount(n)} transactions)` : ''}`;

type Batch = Parameters<typeof closePositions>[0];

/**
 * Signs each batch in turn. False when one didn't go through (cancelled in the
 * wallet, busy, or failed): later batches are not attempted.
 */
const runBatches = async (
  items: Batch,
  act: typeof closePositions,
  onBatch: (index: number, total: number) => void,
): Promise<boolean> => {
  const batches = chunk(items, ACTIONS_PER_TX);
  for (const [i, batch] of batches.entries()) {
    onBatch(i, batches.length);
    const result = await act(batch);
    if (result.status !== 'ok' && result.status !== 'noop') {
      return false;
    }
  }
  return true;
};

/**
 * Re-reads the given positions until none of them is still OPENED, and
 * returns their fresh state. A position a counterparty fully filled before
 * our close landed may already be CLOSED; one that is still OPENED after the
 * timeout is left out of the withdraw and stays selected.
 */
const waitUntilClosed = async (ids: PositionId[]): Promise<Batch> => {
  const deadline = Date.now() + CLOSE_WAIT_MS;
  for (;;) {
    const fresh = await fetchPositionsById(ids);
    const stillOpen = [...fresh.values()].some(
      p => p.state?.state === PositionState_PositionStateEnum.OPENED,
    );
    if (!stillOpen || Date.now() >= deadline) {
      return ids.flatMap(id => {
        const position = fresh.get(bech32mPositionId(id));
        return position?.state?.state === PositionState_PositionStateEnum.CLOSED
          ? [{ id, position }]
          : [];
      });
    }
    await new Promise<void>(resolve => {
      setTimeout(resolve, CLOSE_POLL_MS);
    });
  }
};

/**
 * What the checked rows will do, shown before anything is signed. Replaces
 * "Close Batch (15)", which closed the first 15 rows of whatever sort was
 * active without saying which.
 */
export const SelectionBar = observer(
  ({
    selected,
    matchingCount,
    matchingLabel,
    onSelectAllMatching,
    onClear,
  }: {
    selected: DisplayPosition[];
    /** Positions the current filter shows that can be acted on. */
    matchingCount: number;
    /** Appended to "Select all N", e.g. "in range". */
    matchingLabel?: string;
    onSelectAllMatching: () => void;
    onClear: () => void;
  }) => {
    const [progress, setProgress] = useState<string>();

    const closeable = selected.filter(p => p.isOpened);
    const withdrawable = selected.filter(p => p.isClosed);
    const busy = progress !== undefined || inFlightPositions.hasAny(selected.map(p => p.idString));

    const toBatch = (positions: DisplayPosition[]): Batch =>
      positions.map(p => ({ id: p.id, position: p.position }));

    const run = async (label: string, positions: DisplayPosition[], act: typeof closePositions) => {
      try {
        const done = await runBatches(toBatch(positions), act, (i, n) =>
          setProgress(`${label} ${i + 1} of ${n}…`),
        );
        if (done) {
          onClear();
        }
      } finally {
        setProgress(undefined);
      }
    };

    // Close everything open, wait for the chain to apply the closes, then
    // withdraw both those and whatever was already closed.
    const remove = async () => {
      try {
        const closed = await runBatches(toBatch(closeable), closePositions, (i, n) =>
          setProgress(`Step 1/2: closing ${i + 1} of ${n}…`),
        );
        if (!closed) {
          return;
        }
        setProgress('Step 1/2: waiting for the closes to land…');
        const justClosed = await waitUntilClosed(closeable.map(p => p.id));
        const toWithdraw = [...justClosed, ...toBatch(withdrawable)];
        const withdrawn = await runBatches(toWithdraw, withdrawPositions, (i, n) =>
          setProgress(`Step 2/2: withdrawing ${i + 1} of ${n}…`),
        );
        if (withdrawn && justClosed.length === closeable.length) {
          onClear();
        }
      } finally {
        setProgress(undefined);
        await updatePositionsQuery().catch(() => undefined);
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
            {matchingLabel ? ` ${matchingLabel}` : ''}
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
              {withTxCount('Close', closeable.length)}
            </Button>
          )}
          {withdrawable.length > 0 && (
            <Button
              density='compact'
              actionType='destructive'
              disabled={busy}
              onClick={() => void run('Withdrawing', withdrawable, withdrawPositions)}
            >
              {withTxCount('Withdraw', withdrawable.length)}
            </Button>
          )}
          {closeable.length > 0 && (
            <Button
              density='compact'
              actionType='destructive'
              disabled={busy}
              onClick={() => void remove()}
            >
              {`Remove ${selected.length} (close + withdraw)`}
            </Button>
          )}
        </div>
      </div>
    );
  },
);

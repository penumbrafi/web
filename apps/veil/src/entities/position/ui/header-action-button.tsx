'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { DisplayPosition } from '../model/types';
import { withdrawPositions } from '../api/withdraw-positions';
import { closePositions } from '../api/close-positions';
import { inFlightPositions } from '../api/position-actions-lock';

const MAX_ACTION_COUNT = 15;

export const HeaderActionButton = observer(
  ({ displayPositions }: { displayPositions: DisplayPosition[] }) => {
    const [localLoading, setLocalLoading] = useState(false);

    const openedPositions = displayPositions
      .filter(position => position.isOpened)
      .slice(0, MAX_ACTION_COUNT)
      .map(position => ({ id: position.id, position: position.position }));

    const closedPositions = displayPositions
      .filter(position => position.isClosed)
      .slice(0, MAX_ACTION_COUNT)
      .map(position => ({ id: position.id, position: position.position }));

    const openedBech32 = openedPositions.map(p => bech32mPositionId(p.id));
    const closedBech32 = closedPositions.map(p => bech32mPositionId(p.id));

    const withdraw = async () => {
      setLocalLoading(true);
      try {
        await withdrawPositions(closedPositions);
      } finally {
        setLocalLoading(false);
      }
    };

    const close = async () => {
      setLocalLoading(true);
      try {
        await closePositions(openedPositions);
      } finally {
        setLocalLoading(false);
      }
    };

    if (openedPositions.length > 1) {
      const disabled = localLoading || inFlightPositions.hasAny(openedBech32);
      return (
        <Button actionType='destructive' disabled={disabled} onClick={() => void close()}>
          Close Batch ({openedPositions.length})
        </Button>
      );
    }

    if (closedPositions.length > 1) {
      const disabled = localLoading || inFlightPositions.hasAny(closedBech32);
      return (
        <Button actionType='destructive' disabled={disabled} onClick={() => void withdraw()}>
          Withdraw Batch ({closedPositions.length})
        </Button>
      );
    }

    return 'Actions';
  },
);

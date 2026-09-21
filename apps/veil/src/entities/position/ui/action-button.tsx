'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import {
  Position,
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { withdrawPositions } from '../api/withdraw-positions';
import { closePositions } from '../api/close-positions';
import { inFlightPositions } from '../api/position-actions-lock';
import { Dash } from './dash';
import { EditPositionModal } from './edit-position-modal';
import { fullyWithdrawn } from '@/shared/utils/position';

export const ActionButton = observer(({ id, position }: { id: PositionId; position: Position }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const state = position.state;
  const bech32 = bech32mPositionId(id);
  const disabled = isLoading || inFlightPositions.has(bech32);

  const withdraw = async () => {
    setIsLoading(true);
    try {
      await withdrawPositions([{ position, id }]);
    } finally {
      setIsLoading(false);
    }
  };

  const close = async () => {
    setIsLoading(true);
    try {
      await closePositions([{ position, id }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (state?.state === PositionState_PositionStateEnum.OPENED) {
    return (
      <div className='flex gap-1'>
        <Button priority='secondary' onClick={() => setEditOpen(true)} disabled={disabled}>
          Edit
        </Button>
        <Button onClick={() => void close()} disabled={disabled}>
          Close
        </Button>
        {editOpen && (
          <EditPositionModal
            id={id}
            position={position}
            isOpen={editOpen}
            onClose={() => setEditOpen(false)}
          />
        )}
      </div>
    );
  } else if (!fullyWithdrawn(position)) {
    return (
      <Button disabled={disabled} onClick={() => void withdraw()}>
        Withdraw
      </Button>
    );
  } else {
    return <Dash />;
  }
});

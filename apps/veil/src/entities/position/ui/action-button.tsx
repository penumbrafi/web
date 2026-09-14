'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import {
  Position,
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { withdrawPositions } from '../api/withdraw-positions';
import { closePositions } from '../api/close-positions';
import { Dash } from './dash';
import { EditPositionModal } from './edit-position-modal';
import { fullyWithdrawn } from '@/shared/utils/position';

export const ActionButton = observer(({ id, position }: { id: PositionId; position: Position }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const state = position.state;

  const withdraw = async () => {
    setIsLoading(true);
    await withdrawPositions([{ position, id }]);
    setIsLoading(false);
  };

  const close = async () => {
    setIsLoading(true);
    await closePositions([{ position, id }]);
    setIsLoading(false);
  };

  if (state?.state === PositionState_PositionStateEnum.OPENED) {
    return (
      <div className='flex gap-1'>
        <Button priority='secondary' onClick={() => setEditOpen(true)} disabled={isLoading}>
          Edit
        </Button>
        <Button onClick={() => void close()} disabled={isLoading}>
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
      <Button disabled={isLoading} onClick={() => void withdraw()}>
        Withdraw
      </Button>
    );
  } else {
    return <Dash />;
  }
});

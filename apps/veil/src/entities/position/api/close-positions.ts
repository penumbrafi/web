import {
  Position,
  PositionId,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { connectionStore } from '@/shared/model/connection';
import { planBuildBroadcast } from '@/entities/transaction';
import { userDeniedTransaction } from '@/entities/transaction/model/validations';
import { openToast } from '@penumbra-zone/ui/Toast';
import { updatePositionsQuery } from './use-positions';
import { tryAcquire, conflictingIds } from './position-actions-lock';

export type ActionResult =
  | { status: 'ok' }
  | { status: 'busy'; conflictingIds: string[] }
  | { status: 'noop' }
  | { status: 'cancelled' }
  | { status: 'error'; error: unknown };

export const closePositions = async (
  positions: { id: PositionId; position: Position }[],
): Promise<ActionResult> => {
  if (!positions.length) {
    return { status: 'noop' };
  }

  const ids = positions.map(p => p.id);
  const lease = tryAcquire(ids);
  if (!lease) {
    const busyIds = conflictingIds(ids);
    openToast({
      type: 'info',
      message: 'Some positions are already being acted on',
      description: 'Wait for the in-flight close/withdraw to finish before retrying.',
    });
    return { status: 'busy', conflictingIds: busyIds };
  }

  try {
    try {
      const planReq = new TransactionPlannerRequest({
        positionCloses: positions.map(({ id }) => ({ positionId: id })),
        source: new AddressIndex({ account: connectionStore.subaccount }),
      });

      await planBuildBroadcast('positionClose', planReq);
    } catch (e) {
      if (userDeniedTransaction(e)) {
        return { status: 'cancelled' };
      }
      openToast({
        type: 'error',
        message: 'Error with close action',
        description: String(e),
      });
      return { status: 'error', error: e };
    }
  } finally {
    lease.release();
  }

  // Refresh is best-effort; a failure here does NOT mean the tx failed.
  try {
    await updatePositionsQuery();
  } catch (e) {
    console.warn('updatePositionsQuery failed after close', e);
  }

  return { status: 'ok' };
};

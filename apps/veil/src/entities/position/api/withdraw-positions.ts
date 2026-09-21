import {
  Position,
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { ViewService } from '@penumbra-zone/protobuf';
import { openToast } from '@penumbra-zone/ui/Toast';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { planBuildBroadcast } from '@/entities/transaction';
import { userDeniedTransaction } from '@/entities/transaction/model/validations';
import { updatePositionsQuery } from './use-positions';
import { tryAcquire, conflictingIds } from './position-actions-lock';
import type { ActionResult } from './close-positions';

export type { ActionResult };

export const withdrawPositions = async (
  positions: { id: PositionId; position: Position }[],
): Promise<ActionResult> => {
  const positionWithdraws = positions
    .filter(({ position }) => position.state?.state === PositionState_PositionStateEnum.CLOSED)
    .map(({ id, position }) => ({
      positionId: id,
      tradingPair: position.phi?.pair,
      reserves: position.reserves,
    }));

  if (!positionWithdraws.length) {
    openToast({
      type: 'info',
      message: 'Nothing to withdraw',
      description: 'No closed positions available to withdraw in this selection.',
    });
    return { status: 'noop' };
  }

  // Query the balance for opened-LPNFT presence so we know which auto-closed
  // positions still need a matching positionClose action emitted alongside the
  // withdraw (the chain rejects a withdraw whose opened LPNFT is still around).
  const balances = await Array.fromAsync(penumbra.service(ViewService).balances({}));
  const openedPositionIdStrings = balances
    .filter(
      ({ balanceView }) =>
        balanceView?.valueView.case === 'knownAssetId' &&
        balanceView.valueView.value.metadata?.base.startsWith('lpnft_opened_'),
    )
    .map(
      ({ balanceView }) =>
        (balanceView?.valueView.case === 'knownAssetId' &&
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Short-circuits properly
          balanceView.valueView.value.metadata?.base.replace('lpnft_opened_', '')) ||
        '',
    );

  const positionCloses = positions
    .filter(({ position }) => position.state?.state === PositionState_PositionStateEnum.CLOSED)
    .filter(({ id }) => openedPositionIdStrings.includes(bech32mPositionId(id)))
    .map(({ id: positionId }) => ({ positionId }));

  // Lease covers every position id this tx will spend — the withdraws AND the
  // conditional closes. A concurrent closePositions() on the same id must be
  // blocked.
  const leaseIds: PositionId[] = [
    ...positionWithdraws.map(w => w.positionId),
    ...positionCloses.map(c => c.positionId),
  ];
  const lease = tryAcquire(leaseIds);
  if (!lease) {
    const busyIds = conflictingIds(leaseIds);
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
        positionWithdraws,
        positionCloses,
        source: new AddressIndex({ account: connectionStore.subaccount }),
      });

      await planBuildBroadcast('positionWithdraw', planReq);
    } catch (e) {
      if (userDeniedTransaction(e)) {
        return { status: 'cancelled' };
      }
      openToast({
        type: 'error',
        message: 'Error with withdraw action',
        description: String(e),
      });
      return { status: 'error', error: e };
    }
  } finally {
    lease.release();
  }

  try {
    await updatePositionsQuery();
  } catch (e) {
    console.warn('updatePositionsQuery failed after withdraw', e);
  }

  return { status: 'ok' };
};

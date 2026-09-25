import {
  Position,
  PositionId,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { ViewService } from '@penumbra-zone/protobuf';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { openToast } from '@penumbra-zone/ui/Toast';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { planBuildBroadcast } from '@/entities/transaction';
import { userDeniedTransaction } from '@/entities/transaction/model/validations';
import { encodeLiquidityShape, LiquidityDistributionShape } from '@/shared/math/position';
import { updatePositionsQuery } from './use-positions';
import { tryAcquire, conflictingIds } from './position-actions-lock';
import type { ActionResult } from './close-positions';

export type { ActionResult };

// Edit = positionClose(old) + positionOpen(new) in one tx.
//
// We do NOT bundle a positionWithdraw for the old position: the chain
// evaluates each action against pre-tx state, so a withdraw in the same tx
// as the close is rejected with "expected Closed" (the close hasn't landed
// yet). More importantly, wallet-side proving requires a witness over the
// closed-LPNFT note commitment, which doesn't exist until the close tx is
// committed and the wallet scans it — impossible to build inside a single
// tx no matter what proving speeds look like in the future.
//
// The new position funds itself from wallet balance. The old position's
// reserves become withdrawable separately once the close lands. If the user
// doesn't have enough wallet balance for the new position's reserves, we
// error out clearly before broadcast rather than letting the plan fail with
// "Not enough funds."
export const editPosition = async ({
  oldPositionId,
  newPosition,
  shape,
}: {
  oldPositionId: PositionId;
  newPosition: Position;
  shape: LiquidityDistributionShape;
}): Promise<ActionResult> => {
  const pair = newPosition.phi?.pair;
  const r1 = newPosition.reserves?.r1;
  const r2 = newPosition.reserves?.r2;
  if (!pair?.asset1 || !pair.asset2 || !r1 || !r2) {
    openToast({
      type: 'error',
      message: 'Malformed position',
      description: 'New position is missing asset ids or reserves.',
    });
    return { status: 'error', error: new Error('malformed position') };
  }

  const subaccount = connectionStore.subaccount;
  const need1 = joinLoHiAmount(r1);
  const need2 = joinLoHiAmount(r2);

  // Pre-check wallet balance: sum this subaccount's balances for each asset
  // and confirm we can fund the new position without touching the reserves
  // still locked in the (about-to-be-closed) old position.
  const balances = await Array.fromAsync(
    penumbra.service(ViewService).balances({
      accountFilter: new AddressIndex({ account: subaccount, randomizer: new Uint8Array(0) }),
    }),
  );

  const sumForAsset = (assetId: AssetId): bigint => {
    let total = 0n;
    for (const { balanceView } of balances) {
      if (balanceView?.valueView.case !== 'knownAssetId') {
        continue;
      }
      const v = balanceView.valueView.value;
      const id = v.metadata?.penumbraAssetId;
      if (!id || !assetId.equals(id)) {
        continue;
      }
      if (v.amount) {
        total += joinLoHiAmount(v.amount);
      }
    }
    return total;
  };

  const have1 = sumForAsset(pair.asset1);
  const have2 = sumForAsset(pair.asset2);

  if (have1 < need1 || have2 < need2) {
    openToast({
      type: 'error',
      message: 'Not enough wallet balance to edit',
      description:
        "The position's reserves are locked until it's closed AND withdrawn. " +
        'Close this position, wait for it to become withdrawable, withdraw it, ' +
        'then open a new position with the freed funds — or top up your wallet ' +
        'balance for the two assets first.',
    });
    return { status: 'error', error: new Error('insufficient wallet balance for new position') };
  }

  const lease = tryAcquire([oldPositionId]);
  if (!lease) {
    openToast({
      type: 'info',
      message: 'This position is already being acted on',
      description: 'Wait for the in-flight close/withdraw to finish before editing.',
    });
    return { status: 'busy', conflictingIds: conflictingIds([oldPositionId]) };
  }

  try {
    try {
      const planReq = new TransactionPlannerRequest({
        positionCloses: [{ positionId: oldPositionId }],
        positionOpens: [
          { position: newPosition, positionMeta: { strategy: encodeLiquidityShape(shape) } },
        ],
        source: new AddressIndex({ account: subaccount }),
      });

      await planBuildBroadcast('positionOpen', planReq);
    } catch (e) {
      if (userDeniedTransaction(e)) {
        return { status: 'cancelled' };
      }
      openToast({
        type: 'error',
        message: 'Error editing position',
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
    console.warn('updatePositionsQuery failed after edit', e);
  }

  return { status: 'ok' };
};

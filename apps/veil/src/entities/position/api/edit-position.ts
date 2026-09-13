import {
  Position,
  PositionId,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { connectionStore } from '@/shared/model/connection';
import { planBuildBroadcast } from '@/entities/transaction';
import { openToast } from '@penumbra-zone/ui/Toast';
import { encodeLiquidityShape, LiquidityDistributionShape } from '@/shared/math/position';
import { updatePositionsQuery } from './use-positions';

// Combines positionClose + positionWithdraw + positionOpen into one tx so
// the trader sees a single signing prompt and the reserves flow through:
// close burns the LPNFT, withdraw redeems its reserves as spendable notes,
// open funds the new position from those same notes. Without the withdraw
// step the open tries to fund itself from the wallet's *other* balance
// and the user hits "Not enough funds" even though they have plenty
// locked in the position they're repricing.
//
// Requires that `oldPosition` (the Position value the user is repricing)
// is passed alongside so the withdraw action can reference its
// tradingPair + reserves — the planner won't infer them from the id
// alone.
export const editPosition = async ({
  oldPositionId,
  oldPosition,
  newPosition,
  shape,
}: {
  oldPositionId: PositionId;
  oldPosition: Position;
  newPosition: Position;
  shape: LiquidityDistributionShape;
}): Promise<void> => {
  try {
    const planReq = new TransactionPlannerRequest({
      positionCloses: [{ positionId: oldPositionId }],
      positionWithdraws: [
        {
          positionId: oldPositionId,
          tradingPair: oldPosition.phi?.pair,
          reserves: oldPosition.reserves,
        },
      ],
      positionOpens: [
        { position: newPosition, positionMeta: { strategy: encodeLiquidityShape(shape) } },
      ],
      source: new AddressIndex({ account: connectionStore.subaccount }),
    });

    await planBuildBroadcast('positionOpen', planReq);
    await updatePositionsQuery();
  } catch (e) {
    openToast({
      type: 'error',
      message: 'Error editing position',
      description: String(e),
    });
  }
};

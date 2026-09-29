import { Address } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { TransactionPlan } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { Code, ConnectError } from '@connectrpc/connect';

export const assertSwapClaimAddressesBelongToCurrentUser = async (
  plan: TransactionPlan,
  isControlledAddress: (address?: Address) => boolean | Promise<boolean>,
): Promise<void> => {
  for (const action of plan.actions) {
    if (action.action.case !== 'swap') {
      continue;
    }

    if (!(await isControlledAddress(action.action.value.swapPlaintext?.claimAddress))) {
      throw new ConnectError(
        "Tried to initiate a swap with a claim address belonging to a different user. This means that, when the swap is claimed, the funds would go to someone else's address, not yours. This should never happen. The website you are using may be trying to steal your funds!",
        Code.PermissionDenied,
      );
    }
  }
};

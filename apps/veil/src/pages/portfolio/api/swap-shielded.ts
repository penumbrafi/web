import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { ViewService } from '@penumbra-zone/protobuf';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { Metadata, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  getAssetIdFromValueView,
  getDisplayDenomExponentFromValueView,
} from '@penumbra-zone/getters/value-view';
import { getBalanceView } from '@penumbra-zone/getters/balances-response';
import { getSwapCommitmentFromTx } from '@penumbra-zone/getters/transaction';
import { toBaseUnit } from '@penumbra-zone/types/lo-hi';
import { fromValueView } from '@penumbra-zone/types/amount';
import BigNumber from 'bignumber.js';
import { penumbra } from '@/shared/const/penumbra';
import { planBuildBroadcast } from '@/entities/transaction';

export interface SwapShieldedArgs {
  selection: BalancesResponse;
  amount: string;
  toAsset: Metadata;
  source: AddressIndex;
}

const fetchClaimAddress = async (source: AddressIndex): Promise<Address> => {
  const { address } = await penumbra.service(ViewService).addressByIndex({ addressIndex: source });
  if (!address) {
    throw new Error('view service returned no address for subaccount');
  }
  return address;
};

export const swapShielded = async ({ selection, amount, toAsset, source }: SwapShieldedArgs) => {
  const balanceView = getBalanceView(selection);
  const value = new Value({
    amount: toBaseUnit(BigNumber(amount), getDisplayDenomExponentFromValueView(balanceView)),
    assetId: getAssetIdFromValueView(balanceView),
  });

  const targetAsset = toAsset.penumbraAssetId;
  if (!targetAsset) {
    throw new Error('target asset has no asset id');
  }

  const claimAddress = await fetchClaimAddress(source);

  const swapReq = new TransactionPlannerRequest({
    swaps: [{ targetAsset, value, claimAddress }],
    source,
  });

  const swapResult = await planBuildBroadcast('swap', swapReq);
  if (!swapResult) {
    return undefined;
  }

  // The wallet must have SCANNED the swap block before we can plan the claim
  // against it -- otherwise the planner throws "Swap record not found". The
  // swap itself is already on chain at this point, so bailing here is safe:
  // the claim is finished by the wallet as it syncs, and returning early is
  // strictly better than broadcasting a claim we know will fail.
  if (!swapResult.viewSeen) {
    return undefined;
  }

  // `.transaction`, not the result wrapper -- `planBuildBroadcast` returns
  // `{ transaction, viewSeen }`, and passing the wrapper made this throw
  // before it could build the claim at all.
  const swapCommitment = getSwapCommitmentFromTx(swapResult.transaction);
  const claimReq = new TransactionPlannerRequest({
    swapClaims: [{ swapCommitment }],
    source,
  });
  return planBuildBroadcast('swapClaim', claimReq, { skipAuth: true });
};

export const swapValidationErrors = ({
  selection,
  toAsset,
  amount,
}: {
  selection: BalancesResponse | undefined;
  toAsset: Metadata | undefined;
  amount: string;
}) => {
  const balanceView = getBalanceView.optional(selection);
  if (!selection || !balanceView) {
    return { amountErr: false, exponentErr: false, sameAssetErr: false };
  }

  const exponent = getDisplayDenomExponentFromValueView.optional(balanceView);
  const fraction = amount.split('.')[1]?.length;
  const exponentErr =
    typeof exponent !== 'undefined' && typeof fraction !== 'undefined' && fraction > exponent;

  const amountErr = Boolean(amount) && BigNumber(amount).gt(fromValueView(balanceView));

  const fromAssetId = getAssetIdFromValueView.optional(balanceView);
  const sameAssetErr = Boolean(fromAssetId && toAsset?.penumbraAssetId?.equals(fromAssetId));

  return { amountErr, exponentErr, sameAssetErr };
};

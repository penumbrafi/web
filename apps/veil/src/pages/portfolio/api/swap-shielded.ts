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

  // Broadcast the swap and stop. The CLAIM is the wallet's job: Zafu's
  // `usePenumbraSwapClaim` polls `unclaimedSwaps` and claims every outstanding
  // one, so a claim issued here is a coin-flip against that tick -- whichever
  // lands second is rejected with "nullifier already spent", which is what
  // happened to swapClaim 2699d451. veil cannot lock against another process,
  // so it must not be a second claimer.
  return planBuildBroadcast('swap', swapReq);
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

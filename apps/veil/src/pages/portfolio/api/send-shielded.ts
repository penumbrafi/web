import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { MemoPlaintext } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import {
  getAssetIdFromValueView,
  getDisplayDenomExponentFromValueView,
} from '@penumbra-zone/getters/value-view';
import { getAddress, getAddressIndex } from '@penumbra-zone/getters/address-view';
import { getBalanceView } from '@penumbra-zone/getters/balances-response';
import { toBaseUnit } from '@penumbrafi/types/lo-hi';
import { fromValueView } from '@penumbrafi/types/amount';
import BigNumber from 'bignumber.js';
import { planBuildBroadcast } from '@/entities/transaction';

export interface SendShieldedArgs {
  selection: BalancesResponse;
  amount: string;
  recipient: Address;
  memo: string;
  source: AddressIndex;
}

export const sendShielded = async ({
  selection,
  amount,
  recipient,
  memo,
  source,
}: SendShieldedArgs) => {
  const balanceView = getBalanceView(selection);
  const value = new Value({
    amount: toBaseUnit(BigNumber(amount), getDisplayDenomExponentFromValueView(balanceView)),
    assetId: getAssetIdFromValueView(balanceView),
  });

  // The planner requires `returnAddress` to encrypt the memo to a sender; we pass
  // the source account's primary address (an internal-only field, not exposed externally).
  const req = new TransactionPlannerRequest({
    outputs: [{ address: recipient, value }],
    source,
    feeMode: { case: 'autoFee', value: { feeTier: 1 } },
    memo: new MemoPlaintext({
      returnAddress: getAddress(selection.accountAddress),
      text: memo,
    }),
  });

  return planBuildBroadcast('send', req);
};

// 512-byte max memo - 80 bytes for return address = 432 bytes for plaintext.
const MEMO_TEXT_MAX_BYTES = 432;

export const sendValidationErrors = ({
  selection,
  amount,
  memo,
}: {
  selection: BalancesResponse | undefined;
  amount: string;
  memo: string;
}) => {
  const memoErr = new TextEncoder().encode(memo).length > MEMO_TEXT_MAX_BYTES;

  const balanceView = getBalanceView.optional(selection);
  if (!selection || !balanceView) {
    return { amountErr: false, exponentErr: false, memoErr };
  }

  const exponent = getDisplayDenomExponentFromValueView.optional(balanceView);
  const fraction = amount.split('.')[1]?.length;
  const exponentErr =
    typeof exponent !== 'undefined' && typeof fraction !== 'undefined' && fraction > exponent;

  const amountErr = Boolean(amount) && BigNumber(amount).gt(fromValueView(balanceView));

  return { amountErr, exponentErr, memoErr };
};

export const balanceMatchesSubaccount = (
  balance: BalancesResponse,
  subaccount: number,
): boolean => {
  const idx = getAddressIndex.optional(balance.accountAddress);
  return idx?.account === subaccount;
};

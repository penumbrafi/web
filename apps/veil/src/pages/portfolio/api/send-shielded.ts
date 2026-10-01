import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { AssetId, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';
import { MemoPlaintext } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import {
  getAssetIdFromValueView,
  getDisplayDenomExponentFromValueView,
} from '@penumbra-zone/getters/value-view';
import { getAddress, getAddressIndex } from '@penumbra-zone/getters/address-view';
import { getBalanceView } from '@penumbra-zone/getters/balances-response';
import { joinLoHi, splitLoHi, toBaseUnit } from '@penumbrafi/types/lo-hi';
import { fromValueView } from '@penumbrafi/types/amount';
import BigNumber from 'bignumber.js';
import { planBuildBroadcast } from '@/entities/transaction';
import { planTransaction } from '@/entities/transaction/api/plan';

export interface SendShieldedArgs {
  selection: BalancesResponse;
  amount: string;
  recipient: Address;
  memo: string;
  source: AddressIndex;
  /**
   * Send the whole balance with no change note: dry-run to learn the fee, then
   * plan with that fee fixed so the output takes exactly what is left.
   */
  spendAll?: boolean;
  /** The fee asset when the planner leaves it unset (the staking token). */
  stakingAssetId?: AssetId;
}

const sameAsset = (a?: AssetId, b?: AssetId): boolean =>
  !!a && !!b && a.inner.length === b.inner.length && a.inner.every((v, i) => v === b.inner[i]);

const buildSpendAllPlan = async ({
  selection,
  recipient,
  memo,
  source,
  stakingAssetId,
}: Omit<SendShieldedArgs, 'amount' | 'spendAll'>): Promise<TransactionPlannerRequest> => {
  const balanceView = getBalanceView(selection);
  const exponent = getDisplayDenomExponentFromValueView(balanceView);
  const assetId = getAssetIdFromValueView(balanceView);
  const total = fromValueView(balanceView);
  const totalBase = toBaseUnit(BigNumber(total.toString()), exponent);
  const totalBig = joinLoHi(totalBase.lo, totalBase.hi);
  const memoPlaintext = new MemoPlaintext({
    returnAddress: getAddress(selection.accountAddress),
    text: memo,
  });

  // autoFee needs headroom out of the balance to plan at all
  const dryDisplay = BigNumber.max(BigNumber(0), BigNumber(total.toString()).minus(0.001));
  const dryPlan = await planTransaction(
    new TransactionPlannerRequest({
      outputs: [
        {
          address: recipient,
          value: new Value({ amount: toBaseUnit(dryDisplay, exponent), assetId }),
        },
      ],
      source,
      feeMode: { case: 'autoFee', value: { feeTier: 1 } },
      memo: memoPlaintext,
    }),
  );
  const fee = dryPlan.transactionParameters?.fee;
  if (!fee?.amount) {
    throw new Error('planner did not return a fee for the spend-all dry run');
  }

  // An unset fee asset is the staking token, not the asset being sent.
  const feeIsSendAsset = sameAsset(fee.assetId ?? stakingAssetId, assetId);
  const outBig = feeIsSendAsset ? totalBig - joinLoHi(fee.amount.lo, fee.amount.hi) : totalBig;
  if (outBig <= 0n) {
    throw new Error('balance is too small to cover the transaction fee');
  }
  const out = splitLoHi(outBig);

  return new TransactionPlannerRequest({
    outputs: [
      {
        address: recipient,
        value: new Value({ amount: new Amount({ lo: out.lo, hi: out.hi }), assetId }),
      },
    ],
    source,
    feeMode: { case: 'manualFee', value: fee },
    memo: memoPlaintext,
  });
};

export const sendShielded = async ({
  selection,
  amount,
  recipient,
  memo,
  source,
  spendAll = false,
  stakingAssetId,
}: SendShieldedArgs) => {
  if (spendAll) {
    return planBuildBroadcast(
      'send',
      await buildSpendAllPlan({ selection, recipient, memo, source, stakingAssetId }),
    );
  }

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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import {
  AssetId,
  Metadata,
  ValueView,
} from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  Address,
  AddressIndex,
  AddressView,
} from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { TransactionPlan } from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { Fee } from '@penumbra-zone/protobuf/penumbra/core/component/fee/v1/fee_pb';
import { joinLoHi } from '@penumbrafi/types/lo-hi';
import { sendShielded } from './send-shielded';

const planTransaction = vi.hoisted(() => vi.fn());
const planBuildBroadcast = vi.hoisted(() =>
  vi.fn<[string, TransactionPlannerRequest], Promise<unknown>>(),
);
vi.mock('@/entities/transaction/api/plan', () => ({ planTransaction }));
vi.mock('@/entities/transaction', () => ({ planBuildBroadcast }));

const UM = new AssetId({ inner: new Uint8Array(32).fill(1) });
const USDC = new AssetId({ inner: new Uint8Array(32).fill(2) });

const balance = (assetId: AssetId, amount: bigint, exponent: number) =>
  new BalancesResponse({
    accountAddress: new AddressView({
      addressView: {
        case: 'decoded',
        value: { address: new Address(), index: new AddressIndex() },
      },
    }),
    balanceView: new ValueView({
      valueView: {
        case: 'knownAssetId',
        value: {
          amount: { lo: amount, hi: 0n },
          metadata: new Metadata({
            penumbraAssetId: assetId,
            display: 'x',
            denomUnits: [
              { denom: 'x', exponent },
              { denom: 'ux', exponent: 0 },
            ],
          }),
        },
      },
    }),
  });

const planWithFee = (amount: bigint, assetId?: AssetId) =>
  new TransactionPlan({
    transactionParameters: { fee: new Fee({ amount: { lo: amount, hi: 0n }, assetId }) },
  });

const sentRequest = (): TransactionPlannerRequest => {
  const req = planBuildBroadcast.mock.calls[0]?.[1];
  if (!(req instanceof TransactionPlannerRequest)) {
    throw new Error('planBuildBroadcast was not called with a planner request');
  }
  return req;
};

const sentAmount = (): bigint => {
  const amount = sentRequest().outputs[0]?.value?.amount;
  if (!amount) {
    throw new Error('no output amount');
  }
  return joinLoHi(amount.lo, amount.hi);
};

const args = {
  amount: '0',
  recipient: new Address(),
  memo: '',
  source: new AddressIndex(),
  spendAll: true,
  stakingAssetId: UM,
};

describe('sendShielded spendAll', () => {
  beforeEach(() => {
    planTransaction.mockReset();
    planBuildBroadcast.mockReset();
  });

  it('takes the fee out of the output when sending the fee asset', async () => {
    planTransaction.mockResolvedValue(planWithFee(500n));
    await sendShielded({ ...args, selection: balance(UM, 1_000_000n, 6) });
    expect(sentAmount()).toBe(1_000_000n - 500n);
    expect(sentRequest().feeMode.case).toBe('manualFee');
  });

  it('sends the whole balance when the (unset) fee asset is the staking token', async () => {
    planTransaction.mockResolvedValue(planWithFee(500n));
    await sendShielded({ ...args, selection: balance(USDC, 2_000_000n, 6) });
    expect(sentAmount()).toBe(2_000_000n);
  });

  it('treats an explicit fee asset by its id', async () => {
    planTransaction.mockResolvedValue(planWithFee(700n, USDC));
    await sendShielded({ ...args, selection: balance(USDC, 2_000_000n, 6) });
    expect(sentAmount()).toBe(2_000_000n - 700n);
  });

  it('refuses when the fee eats the whole balance', async () => {
    planTransaction.mockResolvedValue(planWithFee(1_000n));
    await expect(sendShielded({ ...args, selection: balance(UM, 1_000n, 6) })).rejects.toThrow(
      /too small/,
    );
    expect(planBuildBroadcast).not.toHaveBeenCalled();
  });
});

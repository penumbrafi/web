import { describe, expect, it } from 'vitest';
import { runInAction } from 'mobx';
import { pnum } from '@penumbra-zone/types/pnum';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { OrderFormStore } from './OrderFormStore';
import type { Trace } from '@/shared/api/server/book/types';

const row = (price: number, amount = 5): Trace => ({
  price: String(price),
  amount: String(amount),
  total: String(amount),
  hops: ['UM', 'USDC'],
});

const BIDS = [row(12), row(10), row(8)];
const ASKS = [row(20), row(12), row(10)];

// `plan` / `hasPlan` gated on a connected account (`OrderFormStore:524`), so
// the fixture has to look like one: an address and a real subaccount index.
const ADDRESS = new Address({ altBech32m: 'penumbra1testaddress' });
const SUBACCOUNT = new AddressIndex({ account: 0 });

const asset = (symbol: string, fill: number, balance?: number): AssetInfo =>
  new AssetInfo(
    new Metadata({ symbol }),
    new AssetId({ inner: new Uint8Array(Array(32).fill(fill)) }),
    6,
    symbol,
    balance,
  );

const UM = asset('UM', 0xaa, 100);
const USDC = asset('USDC', 0xbb, 1000);

/** A Limit tab in take mode, aimed at 11.5 — a buy of the 10 and 12 asks. */
const takeStore = (target = '11.5') => {
  const store = new OrderFormStore();
  store.setSubAccountIndex(SUBACCOUNT);
  store.setAddress(ADDRESS);
  store.setAssets(UM, USDC, true);
  store.setWhichForm('Limit');
  runInAction(() => store.setMarketPrice(11));
  store.limitForm.setBookRows(BIDS, ASKS);
  store.limitForm.setMode('take');
  store.limitForm.setPriceInput(target);
  return store;
};

describe('OrderFormStore take mode', () => {
  it('plans a swap, not a position open', () => {
    const store = takeStore('12.5');
    const plan = store.plan;
    expect(plan).toBeDefined();
    expect(plan?.positionOpens).toHaveLength(0);
    expect(plan?.swaps).toHaveLength(1);
    // 10 UM bought for 110 USDC — the input of a buy is the quote side.
    const swap = plan?.swaps[0];
    expect(swap?.value).toBeDefined();
    expect(pnum(swap?.value?.amount, 6).toNumber()).toBe(110);
    expect(swap?.targetAsset?.toJsonString()).toBe(UM.id.toJsonString());
    expect(store.planShape).toEqual({ opens: 0, swaps: 1 });
    expect(store.hasPlan).toBe(true);
  });

  it('says why the target is out of reach instead of offering submit', () => {
    const store = takeStore('9.5');
    store.limitForm.setDirection('buy');
    expect(store.blockingIssue?.message).toMatch(/Nothing to take/);
    expect(store.blockingIssue?.message).toContain('USDC');
  });

  it('warns without blocking when the order takes the whole book', () => {
    const store = takeStore('25');
    expect(store.blockingIssue).toBeUndefined();
    expect(store.issues.map(i => i.severity)).toEqual(['warning']);
    expect(store.issues[0]?.message).toMatch(/deepest level in view/);
    expect(store.hasPlan).toBe(true);
  });

  it('stops asking for an amount once the sizing has filled it in', () => {
    const store = takeStore();
    expect(store.blockingIssue).toBeUndefined();
    expect(store.issues).toHaveLength(0);
  });

  it('sizes down to the balance and says so, rather than blocking', () => {
    const store = new OrderFormStore();
    store.setSubAccountIndex(SUBACCOUNT);
    store.setAddress(ADDRESS);
    store.setAssets(UM, asset('USDC', 0xbb, 30), true);
    store.setWhichForm('Limit');
    runInAction(() => store.setMarketPrice(11));
    store.limitForm.setBookRows(BIDS, ASKS);
    store.limitForm.setMode('take');
    store.limitForm.setPriceInput('11.5');
    expect(store.blockingIssue).toBeUndefined();
    expect(store.issues[0]?.message).toMatch(/balance/);
    expect(store.limitForm.quoteInput).toBe('30');
  });
});

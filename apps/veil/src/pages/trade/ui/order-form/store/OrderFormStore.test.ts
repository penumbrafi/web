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

/** A Limit tab buying UM at `price` for `quote` USDC against the 10/12/20 asks. */
const limitStore = (price: string, quote: string, { book = true } = {}) => {
  const store = new OrderFormStore();
  store.setSubAccountIndex(SUBACCOUNT);
  store.setAddress(ADDRESS);
  store.setAssets(UM, USDC, true);
  store.setWhichForm('Limit');
  runInAction(() => store.setMarketPrice(11));
  if (book) {
    store.limitForm.setBookRows(BIDS, ASKS);
  }
  store.limitForm.setDirection('buy');
  store.limitForm.setPriceInput(price);
  store.limitForm.setQuoteInput(quote);
  return store;
};

describe('OrderFormStore hybrid limit order', () => {
  it('swaps what crosses and opens a position for the rest, in one transaction', () => {
    const store = limitStore('12.5', '200');
    const plan = store.plan;
    expect(plan?.swaps).toHaveLength(1);
    expect(plan?.positionOpens).toHaveLength(1);
    // 10 UM bought for 110 USDC — the input of a buy is the quote side.
    const swap = plan?.swaps[0];
    expect(pnum(swap?.value?.amount, 6).toNumber()).toBe(110);
    expect(swap?.targetAsset?.toJsonString()).toBe(UM.id.toJsonString());
    expect(store.planShape).toEqual({ opens: 1, swaps: 1 });
    expect(store.hasPlan).toBe(true);
  });

  it('only opens a position when nothing crosses', () => {
    const store = limitStore('9', '100');
    expect(store.plan?.swaps).toHaveLength(0);
    expect(store.plan?.positionOpens).toHaveLength(1);
    expect(store.planShape).toEqual({ opens: 1, swaps: 0 });
  });

  it('only swaps when the book covers the whole order', () => {
    const store = limitStore('12.5', '30');
    expect(store.plan?.swaps).toHaveLength(1);
    expect(store.plan?.positionOpens).toHaveLength(0);
    expect(store.planShape).toEqual({ opens: 0, swaps: 1 });
  });

  it('waits for the route book before offering submit', () => {
    const store = limitStore('11', '100', { book: false });
    expect(store.hasPlan).toBe(false);
    expect(store.blockingIssue?.message).toMatch(/route book/);
  });
});

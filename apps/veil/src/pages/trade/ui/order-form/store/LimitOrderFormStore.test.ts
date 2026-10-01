import { describe, expect, it } from 'vitest';
import { runInAction } from 'mobx';
import { LimitOrderFormStore } from './LimitOrderFormStore';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import type { Trace } from '@/shared/api/server/book/types';

const row = (price: number, amount = 5): Trace => ({
  price: String(price),
  amount: String(amount),
  total: String(amount),
  hops: ['UM', 'USDC'],
});

// Bids arrive best-first (descending); asks arrive worst-first (descending,
// best ask last). Mid is 11 — between the 10 and 12 asks.
const BIDS = [row(12), row(10), row(8)];
const ASKS = [row(20), row(12), row(10)];
const MID = 11;

const asset = (symbol: string, fill: number, balance?: number): AssetInfo => {
  const id = new AssetId({ inner: new Uint8Array(Array(32).fill(fill)) });
  return new AssetInfo(new Metadata({ symbol, penumbraAssetId: id }), id, 6, symbol, balance);
};

const makeStore = ({ book = true } = {}) => {
  const store = new LimitOrderFormStore();
  store.setAssets(asset('UM', 0xaa, 1000), asset('USDC', 0xbb, 1000));
  runInAction(() => (store.marketPrice = MID));
  if (book) {
    store.setBookRows(BIDS, ASKS);
  }
  return store;
};

const buy = (store: LimitOrderFormStore, price: string, quote: string) => {
  store.setDirection('buy');
  store.setPriceInput(price);
  store.setQuoteInput(quote);
};

const sell = (store: LimitOrderFormStore, price: string, base: string) => {
  store.setDirection('sell');
  store.setPriceInput(price);
  store.setBaseInput(base);
};

describe('LimitOrderFormStore hybrid limit order', () => {
  it('takes what crosses and rests the remainder at the limit', () => {
    const store = makeStore();
    buy(store, '11', '100');
    // The 10 ask (5 UM = 50 USDC) is at or below 11; the rest waits at 11.
    expect(store.split?.takeInput).toBe(50);
    expect(store.split?.takeBase).toBe(5);
    expect(store.split?.restInput).toBe(50);
    expect(pnum(store.takePlan?.value.amount, 6).toNumber()).toBe(50);
    expect(store.plan).toBeDefined();
    expect(store.hasPlan).toBe(true);
  });

  it('walks several levels up to the limit', () => {
    const store = makeStore();
    buy(store, '12.5', '200');
    // 10 × 5 + 12 × 5 = 110 USDC crosses; 90 rests at 12.5.
    expect(store.split?.takeInput).toBe(110);
    expect(store.split?.restInput).toBe(90);
    expect(store.split?.takeWorstPrice).toBe(12);
  });

  it('only rests when the limit is behind the book', () => {
    const store = makeStore();
    buy(store, '9', '100');
    expect(store.split?.takeInput).toBe(0);
    expect(store.split?.restInput).toBe(100);
    expect(store.takePlan).toBeUndefined();
    expect(store.plan).toBeDefined();
  });

  it('only takes when the order is smaller than what crosses', () => {
    const store = makeStore();
    buy(store, '12.5', '30');
    expect(store.split?.takeInput).toBe(30);
    expect(store.split?.restInput).toBe(0);
    expect(store.plan).toBeUndefined();
    expect(pnum(store.takePlan?.value.amount, 6).toNumber()).toBe(30);
  });

  it('splits a sell down through the bids, spending base', () => {
    const store = makeStore();
    sell(store, '10.5', '20');
    // The 12 bid (5 UM) is at or above 10.5; 15 UM rests at 10.5.
    expect(store.split?.takeInput).toBe(5);
    expect(store.split?.restInput).toBe(15);
    expect(pnum(store.takePlan?.value.amount, 6).toNumber()).toBe(5);
  });

  it('has no plan until the book arrives', () => {
    const store = makeStore({ book: false });
    buy(store, '11', '100');
    expect(store.bookLoaded).toBe(false);
    expect(store.split).toBeUndefined();
    expect(store.hasPlan).toBe(false);

    store.setBookRows(BIDS, ASKS);
    expect(store.hasPlan).toBe(true);
  });

  it('clears price and amounts after a swap was broadcast', () => {
    const store = makeStore();
    buy(store, '11', '100');
    store.clearAfterSwap();
    expect(store.priceInput).toBe('');
    expect(store.quoteInput).toBe('');
    expect(store.hasPlan).toBe(false);
  });
});

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
  return new AssetInfo(
    new Metadata({ symbol, penumbraAssetId: id }),
    id,
    6,
    symbol,
    balance,
  );
};

const makeStore = (baseBalance?: number, quoteBalance?: number) => {
  const store = new LimitOrderFormStore();
  store.setAssets(asset('UM', 0xaa, baseBalance), asset('USDC', 0xbb, quoteBalance));
  runInAction(() => (store.marketPrice = MID));
  store.setBookRows(BIDS, ASKS);
  store.setMode('take');
  return store;
};

describe('LimitOrderFormStore take mode', () => {
  it('derives the side from the target price against the mid', () => {
    const store = makeStore();
    store.setPriceInput('11.5');
    expect(store.direction).toBe('buy');

    store.setPriceInput('10.5');
    expect(store.direction).toBe('sell');
  });

  it('sizes a buy to the last level at or below the target', () => {
    const store = makeStore(undefined, 1000);
    store.setPriceInput('11.5');
    expect(store.takeSizeStatus).toBe('sized');
    expect(store.baseInput).toBe('5');
    expect(store.quoteInput).toBe('50');

    store.setPriceInput('12.5');
    expect(store.baseInput).toBe('10');
    expect(store.quoteInput).toBe('110');
    expect(store.hasPlan).toBe(true);
    expect(store.takePlan).toBeDefined();
    expect(pnum(store.takePlan?.value.amount, 6).toNumber()).toBe(110);
  });

  it('sizes a sell down through the bids', () => {
    const store = makeStore(undefined, 1000);
    store.setPriceInput('10.5');
    expect(store.direction).toBe('sell');
    expect(store.takeSizeStatus).toBe('sized');
    expect(store.baseInput).toBe('5');
    expect(store.quoteInput).toBe('60');

    store.setPriceInput('9');
    expect(store.baseInput).toBe('10');
    expect(store.quoteInput).toBe('110');
    // The base side is the exact input of a sell swap.
    expect(pnum(store.takePlan?.value.amount, 6).toNumber()).toBe(10);
  });

  it('spends at most the balance when the target costs more', () => {
    const store = makeStore(undefined, 30);
    store.setPriceInput('11.5');
    expect(store.takeSizeStatus).toBe('capped');
    expect(store.baseInput).toBe('3');
    expect(store.quoteInput).toBe('30');
    expect(store.takeLimit?.cappedSymbol).toBe('USDC');

    const sell = makeStore(2, 1000);
    sell.setPriceInput('10.5');
    expect(sell.takeSizeStatus).toBe('capped');
    expect(sell.baseInput).toBe('2');
    expect(sell.quoteInput).toBe('24');
    expect(sell.takeLimit?.cappedSymbol).toBe('UM');
  });

  it('flags a target past the whole visible book', () => {
    const store = makeStore(undefined, 1000);
    store.setPriceInput('25');
    expect(store.takeSizeStatus).toBe('beyond');
    expect(store.baseInput).toBe('15');
    expect(store.quoteInput).toBe('210');
    expect(store.takeLimit?.worstPrice).toBe(20);
    // Still submittable — the user is told, not blocked.
    expect(store.hasPlan).toBe(true);
  });

  it('always finds a level when the side is derived from the mid', () => {
    const store = makeStore(undefined, 1000);
    // Derivation puts the target on the far side of the mid, and the book
    // straddles it, so a derived side always has something to take — 'empty'
    // can only come from an explicitly pinned side.
    const statuses = ['20', '12.5', '11.0001', '10.9999', '9', '5'].map(price => {
      store.setPriceInput(price);
      return [price, store.takeSizeStatus] as const;
    });
    expect(statuses.filter(([, status]) => status === 'empty')).toEqual([]);
    store.setPriceInput('5');
    expect(store.takeSizeStatus).toBe('beyond');
  });

  it('honours a pinned side instead of the derived one', () => {
    const store = makeStore(undefined, 1000);
    // The mid derives 'sell' here, but the trader asked to buy: every ask is
    // above the target, so there is nothing to take and that is reported
    // rather than silently flipped.
    store.setDirection('buy');
    store.setPriceInput('9.5');
    expect(store.direction).toBe('buy');
    expect(store.takeSizeStatus).toBe('empty');
    expect(store.baseInput).toBe('');
    expect(store.quoteInput).toBe('');
    expect(store.hasPlan).toBe(false);
  });

  it('lets a hand-edited amount win until the target changes', () => {
    const store = makeStore(undefined, 1000);
    store.setPriceInput('11.5');
    store.setBaseInput('2');
    expect(store.takeSizeStatus).toBe('manual');
    expect(store.baseInput).toBe('2');

    store.setPriceInput('12.5');
    expect(store.takeSizeStatus).toBe('sized');
    expect(store.baseInput).toBe('10');
  });

  it('waits for the book, then sizes when it lands', () => {
    const store = new LimitOrderFormStore();
    store.setAssets(asset('UM', 0xaa), asset('USDC', 0xbb, 1000));
    runInAction(() => (store.marketPrice = MID));
    store.setMode('take');
    store.setPriceInput('11.5');
    expect(store.takeSizeStatus).toBe('loading');
    expect(store.baseInput).toBe('');

    store.setBookRows(BIDS, ASKS);
    expect(store.takeSizeStatus).toBe('sized');
    expect(store.baseInput).toBe('5');
  });

  it('blocks without a mid to aim from', () => {
    const store = makeStore();
    runInAction(() => (store.marketPrice = 0));
    store.setPriceInput('11.5');
    expect(store.takeSizeStatus).toBe('no-mid');
    expect(store.hasPlan).toBe(false);
  });

  it('clears the target once a take has been broadcast', () => {
    const store = makeStore(undefined, 1000);
    store.setPriceInput('11.5');
    store.clearTake();
    expect(store.priceInput).toBe('');
    expect(store.takeSizeStatus).toBe('idle');
    expect(store.hasPlan).toBe(false);
  });

  it('leaves Rest mode alone', () => {
    const store = makeStore(undefined, 1000);
    store.setMode('rest');
    store.setPriceInput('12');
    store.setQuoteInput('100');
    expect(store.mode).toBe('rest');
    expect(store.takeLimit).toBeUndefined();
    expect(store.takePlan).toBeUndefined();
    expect(store.plan).toBeDefined();
    expect(store.hasPlan).toBe(true);
    // Rest still clears the amounts when the side flips; take mode does not.
    store.setDirection('sell');
    expect(store.quoteInput).toBe('');
  });
});

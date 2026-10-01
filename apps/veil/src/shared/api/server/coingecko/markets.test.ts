import { describe, expect, it } from 'vitest';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  MarketRow,
  OrientRules,
  buildMarkets,
  indexingPrices,
  lastPrice,
  orient,
  parseTickerId,
  toTicker,
  toTrade,
} from './markets';

const asset = (symbol: string, byte: number, exponent: number): Metadata =>
  new Metadata({
    symbol,
    base: `u${symbol.toLowerCase()}`,
    display: symbol.toLowerCase(),
    denomUnits: [
      { denom: `u${symbol.toLowerCase()}`, exponent: 0 },
      { denom: symbol.toLowerCase(), exponent },
    ],
    penumbraAssetId: new AssetId({ inner: new Uint8Array(32).fill(byte) }),
  });

const UM = asset('UM', 0x10, 6);
const USDC = asset('USDC', 0x05, 6);
const OSMO = asset('OSMO', 0x30, 6);
const ATOM = asset('ATOM', 0x20, 6);
const ETH = asset('ETH', 0x40, 18);

const rules: OrientRules = {
  isStable: m => m.symbol === 'USDC',
  stakingHex: Buffer.from(UM.penumbraAssetId!.inner).toString('hex'),
};

const buf = (m: Metadata) => Buffer.from(m.penumbraAssetId!.inner);
const hex = (m: Metadata) => buf(m).toString('hex');
const byHex = new Map([UM, USDC, OSMO, ATOM, ETH].map(m => [buf(m).toString('hex'), m] as const));
const lookup = (id: Buffer) => byHex.get(id.toString('hex'));

const row = (start: Metadata, end: Metadata, over: Partial<MarketRow> = {}): MarketRow => ({
  asset_start: buf(start),
  asset_end: buf(end),
  price: 0,
  high: 0,
  low: 0,
  direct_volume_over_window: 0,
  liquidity: 0,
  ...over,
});

describe('orient', () => {
  it('puts the stable on the target side whichever way round it arrives', () => {
    expect(orient(USDC, UM, rules)).toEqual([UM, USDC]);
    expect(orient(UM, USDC, rules)).toEqual([UM, USDC]);
  });

  it('quotes non-stable pairs in the staking token', () => {
    expect(orient(UM, OSMO, rules)).toEqual([OSMO, UM]);
    expect(orient(OSMO, UM, rules)).toEqual([OSMO, UM]);
  });

  it('falls back to asset-id order, the same both ways', () => {
    expect(orient(OSMO, ATOM, rules)).toEqual([ATOM, OSMO]);
    expect(orient(ATOM, OSMO, rules)).toEqual([ATOM, OSMO]);
  });
});

describe('buildMarkets', () => {
  it('folds both directions into one market with a stable ticker id', () => {
    const markets = buildMarkets(
      [row(USDC, UM, { price: 2, liquidity: 1 }), row(UM, USDC, { price: 0.5 })],
      lookup,
      rules,
    );
    expect(markets).toHaveLength(1);
    const [m] = markets;
    expect(m!.base).toBe(UM);
    expect(m!.target).toBe(USDC);
    expect(m!.forward?.asset_start.equals(buf(UM))).toBe(true);
    expect(m!.reverse?.asset_start.equals(buf(USDC))).toBe(true);
    expect(parseTickerId(m!.tickerId)).toEqual([m!.baseId, m!.targetId]);
    expect(m!.baseId.startsWith('passet1')).toBe(true);
  });

  it('drops pairs with an unknown asset or nothing going on', () => {
    const unknown = asset('X', 0x99, 6);
    const markets = buildMarkets(
      [row(unknown, UM, { price: 1 }), row(OSMO, UM), row(UM, OSMO)],
      lookup,
      rules,
    );
    expect(markets).toEqual([]);
  });
});

describe('toTicker', () => {
  it('reads each side of the volume from its own direction', () => {
    const rowsUmUsdc = [
      // 1 UM = 0.25 USDC; 400 UM and 100 USDC traded in the day.
      row(UM, USDC, {
        price: 0.25,
        high: 0.3,
        low: 0.2,
        direct_volume_over_window: 400e6,
        liquidity: 50e6, // USDC reserves
      }),
      row(USDC, UM, {
        price: 4,
        direct_volume_over_window: 100e6,
        liquidity: 200e6, // UM reserves
      }),
    ];
    const [m] = buildMarkets(rowsUmUsdc, lookup, rules);
    const prices = indexingPrices(rowsUmUsdc, hex(USDC), rules.stakingHex);
    const t = toTicker(m!, { bid: 0.24, ask: 0.26, prices, indexingExponent: 6 });
    expect(t.last_price).toBe('0.25');
    expect(t.base_volume).toBe('400');
    expect(t.target_volume).toBe('100');
    expect(t.high).toBe('0.3');
    expect(t.low).toBe('0.2');
    expect(t.bid).toBe('0.24');
    expect(t.ask).toBe('0.26');
    // 50 USDC at $1 + 200 UM at $0.25.
    expect(t.liquidity_in_usd).toBe('100');
    expect(t.pool_id).toBe(t.ticker_id);
  });

  it('scales by the exponent gap and fills a missing side from the price', () => {
    // 1 ETH (18) = 2000 UM (6): raw price 2000e6 / 1e18.
    const [m] = buildMarkets(
      [row(ETH, UM, { price: 2000e6 / 1e18, direct_volume_over_window: 3e18 })],
      lookup,
      rules,
    );
    expect(lastPrice(m!)).toBeCloseTo(2000);
    const t = toTicker(m!);
    expect(t.base_volume).toBe('3');
    expect(Number(t.target_volume)).toBeCloseTo(6000);
    expect(t.bid).toBeUndefined();
  });

  it('leaves out a book that has never traded, and quotes no stale high/low', () => {
    expect(buildMarkets([row(OSMO, UM, { liquidity: 5e6 })], lookup, rules)).toEqual([]);
    const [m] = buildMarkets(
      [row(OSMO, UM, { price: 2, high: 9, low: 1, liquidity: 5e6 })],
      lookup,
      rules,
    );
    const t = toTicker(m!);
    expect(t.last_price).toBe('2');
    expect(t.high).toBeUndefined();
    expect(t.low).toBeUndefined();
  });
});

describe('indexingPrices', () => {
  it('prices directly against the indexing denom, else through the staking token', () => {
    const prices = indexingPrices(
      [
        row(UM, USDC, { price: 0.25 }),
        row(OSMO, UM, { price: 2 }),
        row(ATOM, USDC, { price: 8 }),
        row(ATOM, UM, { price: 999 }),
      ],
      hex(USDC),
      rules.stakingHex,
    );
    expect(prices.get(hex(USDC))).toBe(1);
    expect(prices.get(hex(UM))).toBe(0.25);
    expect(prices.get(hex(OSMO))).toBe(0.5);
    // A direct price wins over the staking-token route.
    expect(prices.get(hex(ATOM))).toBe(8);
    expect(prices.has(hex(ETH))).toBe(false);
  });

  it('prices the staking token, and everything quoted in it, from the override', () => {
    const prices = indexingPrices(
      [row(UM, USDC, { price: 0.25 }), row(OSMO, UM, { price: 2 })],
      hex(USDC),
      rules.stakingHex,
      0.2,
    );
    expect(prices.get(hex(UM))).toBe(0.2);
    expect(prices.get(hex(OSMO))).toBeCloseTo(0.4);
  });
});

describe('toTrade', () => {
  const at = new Date('2026-10-01T00:00:00Z');
  it('a base→target trace is a sell', () => {
    const t = toTrade(
      { rowid: 7, input: '400000000', output: '100000000', time: at },
      'sell',
      6,
      6,
    );
    expect(t).toEqual({
      trade_id: 7,
      price: '0.25',
      base_volume: '400',
      target_volume: '100',
      trade_timestamp: String(at.getTime() / 1000),
      type: 'sell',
    });
  });

  it('a target→base trace is a buy, priced the same way', () => {
    const t = toTrade({ rowid: 8, input: '100000000', output: '400000000', time: at }, 'buy', 6, 6);
    expect(t.price).toBe('0.25');
    expect(t.base_volume).toBe('400');
    expect(t.target_volume).toBe('100');
    expect(t.type).toBe('buy');
  });
});

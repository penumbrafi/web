import { describe, expect, it } from 'vitest';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { mergeBlockCandles } from '@/shared/api/server/candles/utils';
import type { BlockCandleRow } from '@/shared/database';
import {
  parseDexTraces,
  dexTracesToCandle,
  type CometbftAbciEvent,
  type CometbftDexTrace,
} from './dex-block-candles';

const EXPONENT = 6;
const bytesFor = (n: number) => new Uint8Array(32).fill(n);
/** Same encoding the implementation derives from `Metadata.penumbraAssetId.inner`. */
const id = (n: number) => Buffer.from(bytesFor(n)).toString('base64');

const metadata = (n: number, symbol: string, exponent = EXPONENT) =>
  new Metadata({
    penumbraAssetId: new AssetId({ inner: bytesFor(n) }),
    symbol,
    display: symbol.toLowerCase(),
    denomUnits: [{ denom: symbol.toLowerCase(), exponent, aliases: [] }],
  });

const BASE = 2;
const QUOTE = 7;
const baseMeta = metadata(BASE, 'BASE');
const quoteMeta = metadata(QUOTE, 'QUOTE');
const baseId = id(BASE);
const quoteId = id(QUOTE);
const OTHER = id(9);

const BLOCK_TIME = '2026-09-27T01:12:02.046790978Z';
const BLOCK_SECONDS = Math.floor(Date.parse(BLOCK_TIME) / 1000);

/** One-position execution carrying a 2-asset hop path (a direct swap). */
const execution = (startId: string, endId: string, input: string, output: string) =>
  JSON.stringify({
    input: { amount: { lo: input }, assetId: { inner: startId } },
    output: { amount: { lo: output }, assetId: { inner: endId } },
    traces: [
      {
        value: [
          { amount: { lo: input }, assetId: { inner: startId } },
          { amount: { lo: output }, assetId: { inner: endId } },
        ],
      },
    ],
  });

/** One-position execution carrying an explicit hop path. */
const executionHops = (points: [string, string][]) =>
  JSON.stringify({
    traces: [
      {
        value: points.map(([amount, assetId]) => ({
          amount: { lo: amount },
          assetId: { inner: assetId },
        })),
      },
    ],
  });

const trace = (
  startAssetId: string,
  endAssetId: string,
  input: number,
  output: number,
  direct = true,
): CometbftDexTrace => ({ startAssetId, endAssetId, input, output, direct });

describe('parseDexTraces', () => {
  it('reads the swap executions of a block, skipping everything else', () => {
    const events: CometbftAbciEvent[] = [
      {
        type: 'penumbra.core.component.shielded_pool.v1.EventSpend',
        attributes: [{ key: 'x', value: '1' }],
      },
      {
        type: 'penumbra.core.component.dex.v1.EventBatchSwap',
        attributes: [
          { key: 'batchSwapOutputData', value: '{"not":"a swap execution"}' },
          { key: 'swapExecution1For2', value: execution(baseId, quoteId, '128', '15710') },
          { key: 'swapExecution2For1', value: executionHops([['5000', quoteId], ['40', baseId]]) },
          { key: 'swapExecution1For2', value: '{not json' },
          { key: 'swapExecution1For2', value: executionHops([['9', baseId]]) },
          {
            key: 'swapExecution1For2',
            value: executionHops([['30', baseId], ['31', OTHER], ['4000', quoteId]]),
          },
        ],
      },
    ];

    expect(parseDexTraces(events)).toEqual([
      trace(baseId, quoteId, 128, 15710, true),
      trace(quoteId, baseId, 5000, 40, true),
      trace(baseId, quoteId, 30, 4000, false),
    ]);
  });

  it('returns nothing for a missing or empty event list', () => {
    expect(parseDexTraces(undefined)).toEqual([]);
    expect(parseDexTraces([])).toEqual([]);
  });
});

describe('dexTracesToCandle', () => {
  it('prices a forward-only block in quote per base and volumes it as a sell', () => {
    const bar = dexTracesToCandle([trace(baseId, quoteId, 128, 15710)], BLOCK_TIME, baseMeta, quoteMeta);

    expect(bar?.ohlc).toEqual({
      time: BLOCK_SECONDS,
      open: 15710 / 128,
      high: 15710 / 128,
      low: 15710 / 128,
      close: 15710 / 128,
    });
    expect(bar?.sellVolume).toBe(15710 / 1e6);
    expect(bar?.buyVolume).toBe(0);
    expect(bar?.directVolume).toBe(15710 / 1e6);
    expect(bar?.volume).toBe(15710 / 1e6);
  });

  // pindexer's `price_float` is asset_end per asset_start for *both*
  // directions, so a buy leg's own price is base per quote and the merge is
  // what inverts it. Getting this backwards produced a bar that disagreed with
  // the route's by 1/price².
  it('prices a reverse-only block as the inverse, and volumes it as a buy', () => {
    const bar = dexTracesToCandle([trace(quoteId, baseId, 5000, 40)], BLOCK_TIME, baseMeta, quoteMeta);

    expect(bar?.ohlc.close).toBe(5000 / 40);
    expect(bar?.buyVolume).toBe(5000 / 1e6);
    expect(bar?.sellVolume).toBe(0);
    expect(bar?.directVolume).toBe(5000 / 1e6);
  });

  it('merges both directions of a mixed block the way the route does', () => {
    // A direct sell at 100, a routed sell at 200, and a direct buy at 50 quote
    // per base (100 base out for 5000 quote in). OHLC comes from the forward
    // side only; high/low are widened by the inverted buy extreme; the routed
    // leg is excluded from directVolume but counted in swapVolume. The buy
    // leg's volume is quoted at the merged bar's price (the forward close).
    const bar = dexTracesToCandle(
      [
        trace(baseId, quoteId, 10, 1000, true),
        trace(baseId, quoteId, 10, 2000, false),
        trace(quoteId, baseId, 5000, 100, true),
      ],
      BLOCK_TIME,
      baseMeta,
      quoteMeta,
    );

    expect(bar?.ohlc).toEqual({
      time: BLOCK_SECONDS,
      open: 100,
      close: 200,
      high: 200,
      low: 50,
    });
    expect(bar?.sellVolume).toBe((1000 + 2000) / 1e6);
    expect(bar?.buyVolume).toBe((100 / 1e6) * 200);
    expect(bar?.directVolume).toBe(1000 / 1e6 + (100 / 1e6) * 200);
    expect(bar?.volume).toBe((bar?.sellVolume ?? 0) + (bar?.buyVolume ?? 0));
  });

  it('drops hops whose price is not positive, like the SQL filter does', () => {
    expect(
      dexTracesToCandle([trace(baseId, quoteId, 0, 500)], BLOCK_TIME, baseMeta, quoteMeta),
    ).toBeUndefined();
    expect(
      dexTracesToCandle([trace(baseId, quoteId, 10, 0)], BLOCK_TIME, baseMeta, quoteMeta),
    ).toBeUndefined();
  });

  it('scales the price by the display exponents of the pair', () => {
    const bar = dexTracesToCandle(
      [trace(baseId, quoteId, 128, 15710)],
      BLOCK_TIME,
      baseMeta,
      metadata(QUOTE, 'QUOTE', EXPONENT + 6),
    );

    expect(bar?.ohlc.close).toBe((15710 / 128) * 1e-6);
  });

  it('returns nothing for an unrelated pair, an empty block, a bad time or one asset', () => {
    expect(
      dexTracesToCandle([trace(OTHER, quoteId, 10, 10)], BLOCK_TIME, baseMeta, quoteMeta),
    ).toBeUndefined();
    expect(dexTracesToCandle([], BLOCK_TIME, baseMeta, quoteMeta)).toBeUndefined();
    expect(
      dexTracesToCandle([trace(baseId, quoteId, 10, 10)], 'not a date', baseMeta, quoteMeta),
    ).toBeUndefined();
    expect(
      dexTracesToCandle([trace(baseId, quoteId, 10, 10)], BLOCK_TIME, baseMeta, baseMeta),
    ).toBeUndefined();
  });
});

describe('client bar / server bar parity', () => {
  it('builds the same bar the route merges from the indexer rows', () => {
    const rows: { fwd: BlockCandleRow[]; rev: BlockCandleRow[] } = {
      fwd: [
        {
          height: 12931536,
          start_time: new Date(BLOCK_SECONDS * 1000),
          open: 100,
          close: 200,
          high: 200,
          low: 100,
          swap_volume: 3000,
          direct_volume: 1000,
        },
      ],
      rev: [
        {
          // Reverse rows carry asset_end per asset_start, i.e. base per quote —
          // the same 100/5000 the trace below yields. The merge inverts it.
          height: 12931536,
          start_time: new Date(BLOCK_SECONDS * 1000),
          open: 0.02,
          close: 0.02,
          high: 0.02,
          low: 0.02,
          swap_volume: 100,
          direct_volume: 0,
        },
      ],
    };

    const serverBars = mergeBlockCandles(rows.fwd, rows.rev, baseMeta, quoteMeta);
    const clientBar = dexTracesToCandle(
      [
        trace(baseId, quoteId, 10, 1000, true),
        trace(baseId, quoteId, 10, 2000, false),
        trace(quoteId, baseId, 5000, 100, false),
      ],
      BLOCK_TIME,
      baseMeta,
      quoteMeta,
    );

    expect(serverBars).toHaveLength(1);
    expect(clientBar).toEqual(serverBars[0]);
  });

  it('emits one candle per height, oldest first, whichever side traded there', () => {
    const row = (height: number, seconds: number, price: number): BlockCandleRow => ({
      height,
      start_time: new Date(seconds * 1000),
      open: price,
      close: price,
      high: price,
      low: price,
      swap_volume: 1_000_000,
      direct_volume: 1_000_000,
    });
    // Heights arrive out of order and each one traded on a single side, except
    // the middle height which saw both directions in the same block.
    const forward = [row(30, 300, 2), row(10, 100, 2)];
    const reverse = [row(20, 200, 0.5), row(10, 100, 0.5)];

    const bars = mergeBlockCandles(forward, reverse, baseMeta, quoteMeta);

    // lightweight-charts rejects a series whose times are not strictly ascending.
    expect(bars.map(b => b.ohlc.time)).toEqual([100, 200, 300]);
    // One candle per height, not one per row: the 4 rows collapse to 3 blocks.
    expect(bars).toHaveLength(3);
    // Reverse-only block: prices are inverted at the merge, volume is a buy.
    expect(bars[1]?.ohlc.open).toBe(2);
    expect(bars[1]?.buyVolume).toBeGreaterThan(0);
    expect(bars[1]?.sellVolume).toBe(0);
    // Forward-only block: volume is a sell.
    expect(bars[2]?.sellVolume).toBeGreaterThan(0);
    expect(bars[2]?.buyVolume).toBe(0);
  });
});

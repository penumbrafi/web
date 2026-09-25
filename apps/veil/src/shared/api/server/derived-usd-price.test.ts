import { describe, expect, it, beforeEach } from 'vitest';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  attemptBridge,
  deriveMultiBridge,
  Bridge,
  CacheEntry,
  Simulate,
  Target,
  __resetCacheForTests,
} from './derived-usd-price';

// The pure VWAP math is exercised via an injected `Simulate` that
// returns synthetic fills. We build books that are (a) balanced, (b)
// crossed, (c) thin, (d) empty, (e) manipulation-suspect, and check
// that `attemptBridge` / `deriveMultiBridge` gate correctly.

const makeAssetId = (seed: number): AssetId => {
  const inner = new Uint8Array(32);
  inner[0] = seed % 256;
  return new AssetId({ inner });
};

const um: Target = { assetId: makeAssetId(1), exponent: 6, symbol: 'UM' };
const usdcInj: Bridge = { assetId: makeAssetId(2), exponent: 6, symbol: 'USDC.inj', usd: 1 };
const usdtInj: Bridge = { assetId: makeAssetId(3), exponent: 6, symbol: 'USDT.inj', usd: 1 };

/**
 * Build a `Simulate` that, for each declared (inSymbol → outSymbol)
 * direction, returns the given filled amounts. Any direction not
 * listed returns null (empty book).
 */
type LookupKey = `${string}->${string}`;
type BookMap = Partial<Record<LookupKey, { filledInDisp: number; filledOutDisp: number } | null>>;

const symbolOf = (id: AssetId, tables: { assetId: AssetId; symbol: string }[]): string => {
  for (const t of tables) {if (t.assetId.equals(id)) {return t.symbol;}}
  return '?';
};

const makeSimulate = (books: BookMap, everything: { assetId: AssetId; symbol: string }[]): Simulate =>
  (inAssetId, outAssetId) => {
    const key: LookupKey = `${symbolOf(inAssetId, everything)}->${symbolOf(outAssetId, everything)}`;
    return Promise.resolve(books[key] ?? null);
  };

const tables = [um, usdcInj, usdtInj];
const signal = new AbortController().signal;

beforeEach(() => {
  __resetCacheForTests();
});

describe('attemptBridge', () => {
  it('returns null on an empty buy side', async () => {
    const simulate = makeSimulate({}, tables);
    expect(await attemptBridge(um, usdcInj, simulate, signal)).toBeNull();
  });

  it('returns null on an empty sell side', async () => {
    const simulate = makeSimulate(
      // We buy 500 USDC.inj → 500_000 UM (price $0.001).
      { 'USDC.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 } },
      tables,
    );
    expect(await attemptBridge(um, usdcInj, simulate, signal)).toBeNull();
  });

  it('returns null when combined depth is below the min ($20)', async () => {
    // Buy filled $8, sell filled $5 — total $13 combined, below the
    // $20 floor. Real books with less than this can be moved by a
    // single toy tx and shouldn't seed an LP ladder.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 8, filledOutDisp: 8_000 },
        'UM->USDC.inj': { filledInDisp: 8_000, filledOutDisp: 5 },
      },
      tables,
    );
    expect(await attemptBridge(um, usdcInj, simulate, signal)).toBeNull();
  });

  it('returns null when buy/sell price ratio exceeds 20x', async () => {
    // Buy price $0.001, sell price $0.05 — 50x apart. A one-side
    // spoof or a broken book, not a market we can honestly average.
    // Real wide markets (~10x on-chain UM today) still clear.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 25, filledOutDisp: 25_000 },
        'UM->USDC.inj': { filledInDisp: 200, filledOutDisp: 10 },
      },
      tables,
    );
    expect(await attemptBridge(um, usdcInj, simulate, signal)).toBeNull();
  });

  it('emits a geomean price on a balanced book', async () => {
    // Perfect flat book: buy 500 → 500_000, sell 500_000 → 500. Both
    // sides price $0.001 exactly; geomean = $0.001. Depth = $1000.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 },
        'UM->USDC.inj': { filledInDisp: 500_000, filledOutDisp: 500 },
      },
      tables,
    );
    const attempt = await attemptBridge(um, usdcInj, simulate, signal);
    expect(attempt).not.toBeNull();
    expect(attempt!.usd).toBeCloseTo(0.001, 9);
    expect(attempt!.depthUsd).toBeCloseTo(1000, 3);
    expect(attempt!.bridge).toBe('USDC.inj');
  });
});

describe('deriveMultiBridge', () => {
  it('returns fresh when the only bridge clears the gates', async () => {
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 },
        'UM->USDC.inj': { filledInDisp: 500_000, filledOutDisp: 500 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj], simulate, undefined, signal);
    expect(out.kind).toBe('fresh');
    if (out.kind === 'fresh') {
      expect(out.usd).toBeCloseTo(0.001, 9);
      expect(out.bridge).toBe('USDC.inj');
    }
  });

  it('depth-weights the geomean across two bridges', async () => {
    // USDC.inj: price $0.001, depth $2000.
    // USDT.inj: price $0.002, depth $1000.
    // Weighted geomean = exp((2/3)ln(0.001) + (1/3)ln(0.002)) ≈ 0.00126.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 1000, filledOutDisp: 1_000_000 },
        'UM->USDC.inj': { filledInDisp: 1_000_000, filledOutDisp: 1000 },
        'USDT.inj->UM': { filledInDisp: 500, filledOutDisp: 250_000 },
        'UM->USDT.inj': { filledInDisp: 250_000, filledOutDisp: 500 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj, usdtInj], simulate, undefined, signal);
    expect(out.kind).toBe('fresh');
    if (out.kind === 'fresh') {
      // Deepest bridge wins the reported label.
      expect(out.bridge.startsWith('USDC.inj')).toBe(true);
      // Weighted geomean, not arithmetic average.
      const expected = Math.exp((2 / 3) * Math.log(0.001) + (1 / 3) * Math.log(0.002));
      expect(out.usd).toBeCloseTo(expected, 6);
      expect(out.depthUsd).toBeCloseTo(3000, 3);
    }
  });

  it('serves cached when no bridge clears the gates (no-bridge stale)', async () => {
    const cached: CacheEntry = {
      at: Date.now() - 60_000,
      usd: 0.00123,
      bridge: 'USDC.inj',
      depthUsd: 4000,
    };
    const simulate = makeSimulate({}, tables); // empty everything
    const out = await deriveMultiBridge(um, [usdcInj, usdtInj], simulate, cached, signal);
    expect(out.kind).toBe('stale');
    if (out.kind === 'stale') {
      expect(out.reason).toBe('no-bridge');
      expect(out.entry).toBe(cached);
    }
  });

  it('returns none when nothing to serve at all', async () => {
    const simulate = makeSimulate({}, tables);
    const out = await deriveMultiBridge(um, [usdcInj], simulate, undefined, signal);
    expect(out.kind).toBe('none');
  });

  it('enforces manipulation guard for >5x with thin depth (sticky)', async () => {
    // Cached: $0.001. Fresh derived: $0.01 (10x). Depth $100 combined
    // (< $200 manipulation floor). Must stick to cached.
    const cached: CacheEntry = {
      at: Date.now() - 10_000,
      usd: 0.001,
      bridge: 'USDC.inj',
      depthUsd: 400,
    };
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 50, filledOutDisp: 5_000 }, // price $0.01
        'UM->USDC.inj': { filledInDisp: 5_000, filledOutDisp: 50 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj], simulate, cached, signal);
    expect(out.kind).toBe('stale');
    if (out.kind === 'stale') {expect(out.reason).toBe('sticky');}
  });

  it('does NOT stick when a big move comes with deep depth', async () => {
    // Same 10x jump but depth $600 combined > $200 manipulation floor:
    // accept it as real repricing.
    const cached: CacheEntry = {
      at: Date.now() - 10_000,
      usd: 0.001,
      bridge: 'USDC.inj',
      depthUsd: 400,
    };
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 300, filledOutDisp: 30_000 }, // price $0.01
        'UM->USDC.inj': { filledInDisp: 30_000, filledOutDisp: 300 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj], simulate, cached, signal);
    expect(out.kind).toBe('fresh');
    if (out.kind === 'fresh') {expect(out.usd).toBeCloseTo(0.01, 9);}
  });

  it('single healthy bridge is used even if peers fail their gates', async () => {
    // USDC.inj clears; USDT.inj is too thin (below $20 floor).
    // Aggregate = USDC.inj alone.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 50, filledOutDisp: 50_000 },
        'UM->USDC.inj': { filledInDisp: 50_000, filledOutDisp: 50 },
        'USDT.inj->UM': { filledInDisp: 5, filledOutDisp: 5_000 },
        'UM->USDT.inj': { filledInDisp: 5_000, filledOutDisp: 5 }, // $10 combined depth
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj, usdtInj], simulate, undefined, signal);
    expect(out.kind).toBe('fresh');
    if (out.kind === 'fresh') {
      expect(out.bridge).toBe('USDC.inj');
      expect(out.usd).toBeCloseTo(0.001, 9);
    }
  });
});

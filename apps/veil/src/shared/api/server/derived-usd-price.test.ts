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
  inner[0] = seed & 0xff;
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

const symbolOf = (id: AssetId, tables: Array<{ assetId: AssetId; symbol: string }>): string => {
  for (const t of tables) if (t.assetId.equals(id)) return t.symbol;
  return '?';
};

const makeSimulate = (books: BookMap, everything: Array<{ assetId: AssetId; symbol: string }>): Simulate =>
  async (inAssetId, outAssetId) => {
    const key = `${symbolOf(inAssetId, everything)}->${symbolOf(outAssetId, everything)}` as LookupKey;
    return books[key] ?? null;
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

  it('returns null when depth is below $1000', async () => {
    // Buy filled only $400 worth, sell only $300 → total < 1000.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 400, filledOutDisp: 400_000 },
        'UM->USDC.inj': { filledInDisp: 400_000, filledOutDisp: 300 },
      },
      tables,
    );
    expect(await attemptBridge(um, usdcInj, simulate, signal)).toBeNull();
  });

  it('returns null when the cross is >20%', async () => {
    // Buy at $0.001, sell at $0.0015 — 40% cross.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 },
        'UM->USDC.inj': { filledInDisp: 500_000, filledOutDisp: 750 },
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
    // Cached: $0.001. Fresh derived: $0.01 (10x). Depth ~$1200 (below
    // the $5k floor). Must stick to cached.
    const cached: CacheEntry = {
      at: Date.now() - 10_000,
      usd: 0.001,
      bridge: 'USDC.inj',
      depthUsd: 8000,
    };
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 600, filledOutDisp: 60_000 }, // price $0.01
        'UM->USDC.inj': { filledInDisp: 60_000, filledOutDisp: 600 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj], simulate, cached, signal);
    expect(out.kind).toBe('stale');
    if (out.kind === 'stale') expect(out.reason).toBe('sticky');
  });

  it('does NOT stick when a big move comes with deep depth', async () => {
    // Same 10x jump but depth $12k > $5k manipulation floor: accept it.
    const cached: CacheEntry = {
      at: Date.now() - 10_000,
      usd: 0.001,
      bridge: 'USDC.inj',
      depthUsd: 8000,
    };
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 6000, filledOutDisp: 600_000 }, // price $0.01
        'UM->USDC.inj': { filledInDisp: 600_000, filledOutDisp: 6000 },
      },
      tables,
    );
    const out = await deriveMultiBridge(um, [usdcInj], simulate, cached, signal);
    expect(out.kind).toBe('fresh');
    if (out.kind === 'fresh') expect(out.usd).toBeCloseTo(0.01, 9);
  });

  it('single healthy bridge is used even if peers fail their gates', async () => {
    // USDC.inj clears; USDT.inj crossed >20%. Aggregate = USDC.inj alone.
    const simulate = makeSimulate(
      {
        'USDC.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 },
        'UM->USDC.inj': { filledInDisp: 500_000, filledOutDisp: 500 },
        'USDT.inj->UM': { filledInDisp: 500, filledOutDisp: 500_000 },
        'UM->USDT.inj': { filledInDisp: 500_000, filledOutDisp: 750 }, // 40% cross
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

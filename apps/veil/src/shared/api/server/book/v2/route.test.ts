import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  Position,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import type { BookV2Response } from './types';

const BASE = new AssetId({ inner: new Uint8Array(32).fill(1) });
const QUOTE = new AssetId({ inner: new Uint8Array(32).fill(2) });
const meta = (symbol: string, id: AssetId) =>
  new Metadata({
    symbol,
    display: symbol.toLowerCase(),
    denomUnits: [{ denom: symbol.toLowerCase(), exponent: 6 }],
    penumbraAssetId: id,
  });

const hoisted = vi.hoisted(() => ({
  height: 100n as bigint | undefined,
  scans: 0,
  positions: [] as unknown[],
}));

vi.mock('@/shared/api/server/book/height.ts', () => ({
  getLatestHeight: () => Promise.resolve(hoisted.height),
}));
vi.mock('@/shared/api/fetch-registry', () => ({
  getCachedRegistry: () =>
    Promise.resolve({ getAllAssets: () => [meta('UM', BASE), meta('USDC', QUOTE)] }),
}));
vi.mock('@/shared/utils/protos/utils.ts', () => ({
  createClient: () => ({
    // Every scan streams the whole fixture; the handler keeps only the
    // positions that offer the requested side.
    liquidityPositionsByPrice: async function* () {
      hoisted.scans += 1;
      await Promise.resolve();
      for (const data of hoisted.positions) {
        yield { data };
      }
    },
  }),
}));

// One position per price: asks at 1.01..1.30, bids at 0.99..0.70 (p/q, no fee).
const ladder = () => {
  const out: Position[] = [];
  for (let i = 1; i <= 30; i++) {
    out.push(
      new Position({
        phi: {
          component: { fee: 0, p: { lo: BigInt(100 + i) }, q: { lo: 100n } },
          pair: { asset1: BASE, asset2: QUOTE },
        },
        reserves: { r1: { lo: 1_000_000n }, r2: { lo: 0n } },
        state: { state: PositionState_PositionStateEnum.OPENED },
      }),
      new Position({
        phi: {
          component: { fee: 0, p: { lo: BigInt(100 - i) }, q: { lo: 100n } },
          pair: { asset1: BASE, asset2: QUOTE },
        },
        reserves: { r1: { lo: 0n }, r2: { lo: BigInt(100 - i) * 10_000n } },
        state: { state: PositionState_PositionStateEnum.OPENED },
      }),
    );
  }
  return out;
};

const req = (query: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`/api/book/v2?${query}`, 'https://veil.test'), { headers });

// Fresh module (and so a fresh per-block cache) per test.
const loadGet = async () => {
  vi.resetModules();
  return (await import('./index')).GET;
};

beforeEach(() => {
  process.env['PENUMBRA_GRPC_ENDPOINT'] = 'http://pd.test';
  process.env['PENUMBRA_CHAIN_ID'] = 'penumbra-test';
  hoisted.height = 100n;
  hoisted.scans = 0;
  hoisted.positions = ladder();
});

describe('GET /api/book/v2', () => {
  it('pages levels outward from the touch with plain-number rows', async () => {
    const GET = await loadGet();
    const res = await GET(req('baseAsset=UM&quoteAsset=USDC&levels=10&step=0'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookV2Response;
    expect(body.base).toEqual({ symbol: 'UM', exponent: 6 });
    expect(body.bestBid).toBeCloseTo(0.99);
    expect(body.bestAsk).toBeCloseTo(1.01);
    expect(body.mid).toBeCloseTo(1);
    expect(body.bids.map(l => l.price)[0]).toBeCloseTo(0.99);
    expect(body.bids).toHaveLength(10);
    expect(body.asks[9]?.price).toBeCloseTo(1.1);
    expect(body.asks[0]).toMatchObject({ amount: 1, total: 1, count: 1 });
    expect(body.asks[9]?.total).toBeCloseTo(10);
    expect(body.nextCursorAsk).toBeCloseTo(1.1);

    const next = await GET(
      req(
        `baseAsset=UM&quoteAsset=USDC&levels=10&step=0&cursorAsk=${body.nextCursorAsk}&cursorBid=${body.nextCursorBid}`,
      ),
    );
    const page2 = (await next.json()) as BookV2Response;
    expect(page2.asks[0]?.price).toBeCloseTo(1.11);
    expect(page2.bids[0]?.price).toBeCloseTo(0.89);
    expect(page2.asks[0]?.total).toBeCloseTo(11);
  });

  it('computes once per block for every page, step and viewer', async () => {
    const GET = await loadGet();
    await GET(req('baseAsset=UM&quoteAsset=USDC'));
    await GET(req('baseAsset=UM&quoteAsset=USDC&levels=5&step=0.05'));
    await GET(req('baseAsset=um&quoteAsset=usdc&cursorBid=0.9'));
    // One pair = two scans (bid + ask side), whatever the page parameters.
    expect(hoisted.scans).toBe(2);
  });

  it('echoes the resolved default step and buckets with it', async () => {
    const GET = await loadGet();
    const body = (await (await GET(req('baseAsset=UM&quoteAsset=USDC'))).json()) as BookV2Response;
    // ~0.1% of a mid of 1, snapped.
    expect(body.step).toBe(0.001);
  });

  it('returns 304 for a matching If-None-Match, 200 once the page differs', async () => {
    const GET = await loadGet();
    const first = await GET(req('baseAsset=UM&quoteAsset=USDC'));
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(first.headers.get('cache-control')).toBe('public, max-age=1, stale-while-revalidate=5');

    const again = await GET(req('baseAsset=UM&quoteAsset=USDC', { 'if-none-match': etag ?? '' }));
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);

    const otherPage = await GET(
      req('baseAsset=UM&quoteAsset=USDC&levels=5', { 'if-none-match': etag ?? '' }),
    );
    expect(otherPage.status).toBe(200);
  });

  it('keeps the ETag across a block that did not change the book', async () => {
    const GET = await loadGet();
    const etag = (await GET(req('baseAsset=UM&quoteAsset=USDC'))).headers.get('etag');
    hoisted.height = 101n;
    // The first request at a new height serves the cached book and refreshes
    // in the background; poll until the refreshed (HIT) book is served.
    const conditional = () =>
      GET(req('baseAsset=UM&quoteAsset=USDC', { 'if-none-match': etag ?? '' }));
    await vi.waitFor(async () => {
      const res = await conditional();
      expect(res.headers.get('x-cache')).toBe('HIT');
      expect(res.status).toBe(304);
    });
    expect(hoisted.scans).toBe(4);

    // A book change at the next block does move it.
    hoisted.positions = ladder().slice(2);
    hoisted.height = 102n;
    await vi.waitFor(async () => {
      const res = await conditional();
      expect(res.headers.get('x-cache')).toBe('HIT');
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).not.toBe(etag);
    });
    expect(hoisted.scans).toBe(6);
  });

  it('rejects a request without both assets', async () => {
    const GET = await loadGet();
    expect((await GET(req('baseAsset=UM'))).status).toBe(400);
  });
});

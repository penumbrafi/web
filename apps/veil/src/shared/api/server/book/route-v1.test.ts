import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SimulateTradeResponse } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';

// Handler-level guard for /api/book after its per-block gate moved into
// once-per-block.ts: same headers, same one-compute-per-block behaviour.

const hoisted = vi.hoisted(() => ({ height: 100n as bigint | undefined, simulates: 0 }));

const meta = (symbol: string, n: number) =>
  new Metadata({
    symbol,
    display: symbol.toLowerCase(),
    denomUnits: [{ denom: symbol.toLowerCase(), exponent: 6 }],
    penumbraAssetId: new AssetId({ inner: new Uint8Array(32).fill(n) }),
  });

vi.mock('@/shared/api/server/book/height.ts', () => ({
  getLatestHeight: () => Promise.resolve(hoisted.height),
}));
vi.mock('@/shared/api/fetch-registry', () => ({
  getCachedRegistry: () =>
    Promise.resolve({ getAllAssets: () => [meta('UM', 1), meta('USDC', 2)] }),
}));
vi.mock('@/shared/utils/protos/utils.ts', () => ({
  createClient: () => ({
    simulateTrade: () => {
      hoisted.simulates += 1;
      return Promise.resolve(new SimulateTradeResponse({}));
    },
  }),
}));

const req = (query: string) => new NextRequest(new URL(`/api/book?${query}`, 'https://veil.test'));

const loadGet = async () => {
  vi.resetModules();
  return (await import('./index')).GET;
};

beforeEach(() => {
  process.env['PENUMBRA_GRPC_ENDPOINT'] = 'http://pd.test';
  process.env['PENUMBRA_CHAIN_ID'] = 'penumbra-test';
  hoisted.height = 100n;
  hoisted.simulates = 0;
});

describe('GET /api/book', () => {
  it('computes once per pair per block and serves the cache after', async () => {
    const GET = await loadGet();
    const first = await GET(req('baseAsset=UM&quoteAsset=USDC&traceLimit=100'));
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toEqual({
      singleHops: { buy: [], sell: [] },
      multiHops: { buy: [], sell: [] },
    });

    // Another trace limit, same block: sliced from the same compute.
    const second = await GET(req('baseAsset=UM&quoteAsset=USDC&traceLimit=30'));
    expect(second.headers.get('x-cache')).toBe('HIT');
    // Buy + sell side.
    expect(hoisted.simulates).toBe(2);
  });

  it('serves stale on a new block while one background refresh runs', async () => {
    const GET = await loadGet();
    await GET(req('baseAsset=UM&quoteAsset=USDC'));
    hoisted.height = 101n;
    const res = await GET(req('baseAsset=UM&quoteAsset=USDC'));
    expect(res.headers.get('x-cache')).toBe('STALE-REVALIDATE');
    await GET(req('baseAsset=UM&quoteAsset=USDC'));
    await vi.waitFor(() => expect(hoisted.simulates).toBe(4));
  });
});

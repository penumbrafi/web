import { NextResponse } from 'next/server';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import type { Registry } from '@penumbrafi/registry';
import { uint8ArrayToBase64 } from '@penumbrafi/types/base64';
import { referencePriceFor } from '@/shared/const/reference-price';
import { calculateDisplayPrice } from '@/shared/utils/price-conversion';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { pindexerDb } from '@/shared/database/client';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';
import { timesFor } from './block-times';
import { unregisteredExponent } from './exponents';
import { shieldedRows } from './index';
import { dailyTimes, stateAt, topAndOther, TimedEntry } from './overview-lib';
import { dexUsdSeries, PricePoint } from './pricing';
import { OverviewAsset, ShieldedOverviewResponse } from './types';

const EMPTY: ShieldedOverviewResponse = { times: [], stack: [], otherUsd: [], assets: [] };
const DAY_MS = 86_400_000;
const STACK_SIZE = 8;
const CACHE_MS = 5 * 60_000;

let cache: { at: number; body: ShieldedOverviewResponse } | undefined;

/**
 * USD price of every honestly priceable asset at each of `times`, from
 * Penumbra's own DEX: every pair's daily closes, filtered (see pricing.ts).
 */
const dexPrices = async (registry: Registry, times: number[]) => {
  const metaById = new Map<string, Metadata>();
  const stables = new Set<string>();
  for (const m of registry.getAllAssets()) {
    if (!m.penumbraAssetId) {
      continue;
    }
    const id = uint8ArrayToBase64(m.penumbraAssetId.inner);
    metaById.set(id, m);
    const ref = referencePriceFor(m.symbol);
    if (ref?.kind === 'fixed' && ref.usd === 1) {
      stables.add(id);
    }
  }
  const rows = await pindexerDb
    .selectFrom('dex_ex_price_charts')
    .select(['asset_start', 'asset_end', 'close', 'start_time', 'direct_volume'])
    .where('the_window', '=', '1d')
    .execute();
  const points: PricePoint[] = [];
  for (const r of rows) {
    const base = uint8ArrayToBase64(r.asset_start);
    const quote = uint8ArrayToBase64(r.asset_end);
    const baseMeta = metaById.get(base);
    const quoteMeta = metaById.get(quote);
    if (baseMeta && quoteMeta) {
      points.push({
        base,
        quote,
        timeMs: new Date(r.start_time).getTime(),
        price: calculateDisplayPrice(r.close, baseMeta, quoteMeta),
        // pindexer counts a candle's volume in base units of asset_start.
        volume: r.direct_volume / 10 ** getDisplayDenomExponent(baseMeta),
      });
    }
  }
  return dexUsdSeries({ points, times, stables });
};

const toDisplay = (amount: bigint, exponent: number) => Number(amount) / 10 ** exponent;

const build = async (): Promise<ShieldedOverviewResponse> => {
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    throw new Error('PENUMBRA_CHAIN_ID is not set');
  }
  const [registry, byAsset, tipRow] = await Promise.all([
    withTimeout(getCachedRegistry(chainId), DEFAULT_TIMEOUT_MS, 'shielded-overview registry'),
    shieldedRows(),
    pindexerDb
      .selectFrom('block_details')
      .select('timestamp')
      .orderBy('height', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);
  if (!tipRow) {
    return EMPTY;
  }
  const tipMs = new Date(tipRow.timestamp).getTime();

  const heights = [...byAsset.values()].flatMap(rows => rows.map(r => r.height));
  const times = await timesFor(heights);

  const entries = new Map<string, TimedEntry[]>();
  const metaOf = (id: string) =>
    registry.tryGetMetadata(new AssetId({ inner: Buffer.from(id, 'base64') }));
  let firstMs = tipMs;
  for (const [id, rows] of byAsset) {
    const meta = metaOf(id);
    const exponent = meta ? getDisplayDenomExponent(meta) : unregisteredExponent(id);
    const list: TimedEntry[] = [];
    for (const r of rows) {
      const t = times.get(r.height);
      if (t !== undefined) {
        list.push({
          timeMs: t,
          current: toDisplay(r.current, exponent),
          total: toDisplay(r.total, exponent),
          depositors: r.depositors,
        });
      }
    }
    const first = list[0];
    if (first) {
      firstMs = Math.min(firstMs, first.timeMs);
    }
    entries.set(id, list);
  }

  // Each asset's value at each day, at that day's (filtered) DEX price.
  const days = dailyTimes(firstMs, tipMs);
  const prices = await dexPrices(registry, days);
  const usdSeries = new Map<string, number[]>();
  for (const [id, list] of entries) {
    const price = prices.get(id);
    if (price) {
      usdSeries.set(
        id,
        days.map((t, i) => stateAt(list, t).current * (price[i] ?? 0)),
      );
    }
  }
  const { stack, otherUsd } = topAndOther(usdSeries, STACK_SIZE, days.length);

  const last = days.length - 1;
  const assets: OverviewAsset[] = [...entries].map(([id, list]) => {
    const meta = metaOf(id);
    return {
      assetId: id,
      symbol: meta?.symbol ?? '',
      base: meta?.base ?? '',
      priceUsd: prices.get(id)?.[last],
      now: stateAt(list, tipMs),
      d1: stateAt(list, tipMs - DAY_MS),
      d7: stateAt(list, tipMs - 7 * DAY_MS),
      d30: stateAt(list, tipMs - 30 * DAY_MS),
    };
  });
  const usdNow = (a: OverviewAsset) => (a.priceUsd === undefined ? -1 : a.now.current * a.priceUsd);
  assets.sort((a, b) => usdNow(b) - usdNow(a) || b.now.depositors - a.now.depositors);

  return { times: days, stack, otherUsd, assets };
};

/**
 * The shielded pool at a glance: USD value per day of the largest assets
 * (priced on Penumbra's own DEX), and every asset's state now, 24h, 7d and
 * 30d ago. Public pool-level data, rebuilt at most every 5 minutes.
 */
async function handleGet(): Promise<NextResponse<ShieldedOverviewResponse>> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), body: await build() };
  }
  return NextResponse.json(cache.body, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY,
  logTag: 'shielded-overview',
});

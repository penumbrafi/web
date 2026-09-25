'use server';

import { pindexerDb } from '@/shared/database/client';
import { AssetId, Metadata, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { sql } from 'kysely';
import { indexingAsset } from './indexing-asset';
import { pnum } from '@penumbra-zone/types/pnum';
import { deserialize, serialize, Serialized } from '@/shared/utils/serializer';
import { getCachedRegistry } from '../fetch-registry';
import { getClientSideEnv } from '../env/getClientSideEnv';
import { Registry } from '@penumbrafi/registry';
import { compareAssetId } from '@/shared/math/position';
import { DurationWindow } from '@/shared/utils/duration';
import { referencePriceFor } from '@/shared/const/reference-price';

/**
 * Postgres aggregates come back NULL on empty joins and NUMERIC as strings,
 * whatever the column types say; anything that isn't a finite number is 0.
 */
const finite = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export interface Summary {
  price: number;
  high: number;
  low: number;
  liquidity: Value;
  volume: Value;
  priceDelta: number;
  priceChangePercent: number;
}

export interface SummaryWithPrices extends Summary {
  // Server-side resolved Metadata so /explore is never at the mercy of the
  // client's registry cache freshness. If the server can't resolve either
  // side, `fetchDaySummaries` drops the row rather than shipping a raw
  // AssetId the client would fail to look up (which is what killed the
  // landing page when a newly-listed asset — USDC.inj — wasn't in
  // hydrated client caches yet).
  startAsset: Metadata;
  endAsset: Metadata;
  recentPrices: [Date, number][];
}

const PRIORITIES: Record<string, number> = {
  USDY: 1,
  UM: 0,
};

/**
 * A symbol is "stable" iff REFERENCE_PRICES pegs it to a fixed $1. The old
 * hardcoded `USDC: 2` only matched the bare Noble symbol, so BRIDGED stables
 * — USDC.inj, USDT.inj — scored the -1 fallback and ranked BELOW UM. That is
 * what produced rows like `USDC.inj/UM` and `USDC.inj/INJ`: the stable ended
 * up as the base and the risk asset as the quote.
 *
 * It is not merely cosmetic. Quoting UM in USDC.inj the wrong way round
 * inverts the 24h change: a UM drawdown renders as `USDC.inj/UM +50.00%`,
 * green, reading as "UM is doing great" when UM actually fell by a third.
 *
 * Deriving from `referencePriceFor` matches what summary/pairs.ts already
 * does, so adding a new stable there fixes quotation everywhere at once.
 */
const isStableSymbol = (symbol: string | undefined): boolean => {
  const src = referencePriceFor(symbol);
  return src?.kind === 'fixed' && src.usd === 1;
};

function priority(registry: Registry, asset: AssetId): number | undefined {
  const meta = registry.tryGetMetadata(asset);
  if (!meta) {
    return undefined;
  }
  if (isStableSymbol(meta.symbol)) {
    return 2;
  }
  return PRIORITIES[meta.symbol] ?? -1;
}

function orderedCorrectly(registry: Registry, start: AssetId, end: AssetId): boolean {
  const startPriority = priority(registry, start);
  const endPriority = priority(registry, end);
  if (startPriority === undefined || endPriority === undefined) {
    return false;
  }
  if (endPriority > startPriority) {
    return true;
  }
  // Equal priority (two stables, or two unranked assets) has no preferred
  // quotation, so fall back to a deterministic byte-order tiebreak. This must
  // cover EQUAL priorities generally, not just the unranked pair: once both
  // stables score 2, a `< 0` guard would reject both directions of a
  // stable/stable market like USDC.inj/USDC and drop it from the page.
  if (endPriority === startPriority && compareAssetId(start, end) > 0) {
    return true;
  }
  return false;
}

function basicQuery(window: DurationWindow) {
  return pindexerDb
    .with('summary', db =>
      db.selectFrom('dex_ex_pairs_summary').selectAll().where('the_window', '=', window),
    )
    .with('prices', db =>
      db
        .selectFrom('summary')
        .select(['asset_start', 'price'])
        .where('asset_end', '=', db.selectFrom('dex_ex_metadata').select('quote_asset_id')),
    )
    .with('metrics', db =>
      db
        .selectFrom('summary as d')
        .select([
          eb => eb.fn('least', ['d.asset_start', 'd.asset_end']).as('asset_start'),
          eb => eb.fn('greatest', ['d.asset_start', 'd.asset_end']).as('asset_end'),
        ])
        .select(sql<number>`SUM(liquidity * prices.price)`.as('liquidity'))
        // SUM (not MAX) both direction rows' indexing-denom volume so an
        // unordered pair's 24h volume on /explore reflects trades in
        // BOTH directions — matching the /api/pairs dedup shipped for
        // the trade-page selector. `orderedCorrectly` (below) still
        // filters to one canonical direction per unordered pair, so the
        // summed value isn't double-emitted; each pair renders once.
        .select(qb => qb.fn.sum('direct_volume_indexing_denom_over_window').as('volume'))
        .leftJoin('prices', join =>
          join.on(eb => eb('d.asset_end', '=', eb.ref('prices.asset_start'))),
        )
        .groupBy(eb => eb.fn('least', ['d.asset_start', 'd.asset_end']))
        .groupBy(eb => eb.fn('greatest', ['d.asset_start', 'd.asset_end'])),
    )
    .with('recent_prices', db =>
      db
        .selectFrom('summary as d')
        .leftJoinLateral(
          eb =>
            eb
              .selectFrom('dex_ex_price_charts')
              .select(['start_time', 'close'])
              .where('dex_ex_price_charts.asset_start', '=', eb.ref('d.asset_start'))
              .where('dex_ex_price_charts.asset_end', '=', eb.ref('d.asset_end'))
              .orderBy('start_time', 'desc')
              .limit(24)
              .as('p'),
          join => join.onTrue(),
        )
        .select([
          'd.asset_start',
          'd.asset_end',
          eb =>
            eb.fn
              .coalesce(sql<number[]>`ARRAY_AGG(p.close)`, eb.val<number[]>([]))
              .as('recent_prices'),
          eb =>
            eb.fn
              .coalesce(sql<Date[]>`ARRAY_AGG(p.start_time)`, eb.val<number[]>([]))
              .as('recent_dates'),
        ])
        .groupBy(['d.asset_start', 'd.asset_end']),
    )
    .selectFrom('summary as d')
    .leftJoin('recent_prices as r', join =>
      join
        .on(eb => eb('d.asset_start', '=', eb.ref('r.asset_start')))
        .on(eb => eb('d.asset_end', '=', eb.ref('r.asset_end'))),
    )
    .leftJoin('metrics as m', join =>
      join.on(
        sql`m.asset_start = LEAST(d.asset_start, d.asset_end) AND m.asset_end = GREATEST(d.asset_start, d.asset_end)`,
      ),
    )
    .select([
      'd.asset_start',
      'd.asset_end',
      'm.liquidity',
      'm.volume',
      'recent_prices',
      'recent_dates',
      'd.price',
      'd.price_then',
      'd.high',
      'd.low',
    ]);
}

/**
 * Single-pair variant of `basicQuery` for `fetchSummary`. `basicQuery`
 * builds the whole-market `summary` CTE (referenced three times, so
 * postgres materializes it) and filters the pair only in the outer
 * select — every trade-page summary poll scanned and aggregated every
 * pair's row. Here the pair predicate is pushed into the CTE itself, and
 * `recent_prices` (which `fetchSummary` discards) is dropped.
 *
 * Semantics are preserved on purpose:
 *  - `summary` keeps BOTH directions of the pair, because `metrics`
 *    aggregates liquidity/volume over `LEAST/GREATEST(start, end)`, i.e.
 *    across both direction rows.
 *  - `prices` is sourced from the full table (not the filtered CTE): it
 *    supplies the quote→indexing-asset price for `d.asset_end`, which for
 *    a pair not quoted in USDC lives in a different row.
 * Not exported: this file is `'use server'`, and a query builder is not a
 * server action.
 */
function basicQueryForPair(start: Buffer, end: Buffer, window: DurationWindow) {
  return pindexerDb
    .with('summary', db =>
      db
        .selectFrom('dex_ex_pairs_summary')
        .selectAll()
        .where('the_window', '=', window)
        .where(eb =>
          eb.or([
            eb.and([eb('asset_start', '=', start), eb('asset_end', '=', end)]),
            eb.and([eb('asset_start', '=', end), eb('asset_end', '=', start)]),
          ]),
        ),
    )
    .with('prices', db =>
      db
        .selectFrom('dex_ex_pairs_summary')
        .select(['asset_start', 'price'])
        .where('the_window', '=', window)
        .where('asset_end', '=', db.selectFrom('dex_ex_metadata').select('quote_asset_id'))
        .where('asset_start', 'in', [start, end]),
    )
    .with('metrics', db =>
      db
        .selectFrom('summary as d')
        .select(sql<number>`SUM(d.liquidity * prices.price)`.as('liquidity'))
        .select(qb => qb.fn.max('d.direct_volume_indexing_denom_over_window').as('volume'))
        .leftJoin('prices', join =>
          join.on(eb => eb('d.asset_end', '=', eb.ref('prices.asset_start'))),
        ),
    )
    .selectFrom('summary as d')
    .innerJoin('metrics as m', join => join.onTrue())
    .select(['m.liquidity', 'm.volume', 'd.price', 'd.price_then', 'd.high', 'd.low'])
    .where('d.asset_start', '=', start)
    .where('d.asset_end', '=', end);
}

export async function fetchSummary(
  startAsset: Serialized<AssetId>,
  endAsset: Serialized<AssetId>,
  theWindow: DurationWindow,
): Promise<Serialized<Summary>> {
  const start = deserialize<AssetId>(startAsset);
  const end = deserialize<AssetId>(endAsset);
  const indexingAssetP = indexingAsset();
  // `executeTakeFirstOrThrow` here 500'd the whole trade page for any pair
  // pindexer hasn't seen swap activity on in the requested window — most
  // thin/new pairs. Fall back to a zeroed Summary so the UI renders and
  // the user can still interact (LP form works, book shows, etc.). Same
  // fix we shipped once before; this row survived a merge.
  const data = await basicQueryForPair(
    Buffer.from(start.inner),
    Buffer.from(end.inner),
    theWindow,
  ).executeTakeFirst();
  const theIndexingAsset = await indexingAssetP;
  if (!data) {
    return serialize({
      liquidity: new Value({ amount: pnum(0).toAmount(), assetId: theIndexingAsset }),
      volume: new Value({ amount: pnum(0).toAmount(), assetId: theIndexingAsset }),
      price: 0,
      priceDelta: 0,
      priceChangePercent: 0,
      high: 0,
      low: 0,
    });
  }
  // Guard divides so a summary row where `price_then === 0` doesn't
  // produce Infinity / NaN and blow up JSON serialization downstream.
  const priceThen = finite(data.price_then);
  const price = finite(data.price);
  const priceChangePercent = priceThen > 0 ? 100 * (price / priceThen - 1.0) : 0;
  return serialize({
    liquidity: new Value({
      amount: pnum(finite(data.liquidity)).toAmount(),
      assetId: theIndexingAsset,
    }),
    volume: new Value({ amount: pnum(finite(data.volume)).toAmount(), assetId: theIndexingAsset }),
    price,
    priceDelta: price - priceThen,
    priceChangePercent,
    high: finite(data.high),
    low: finite(data.low),
  });
}

/** Fetch summaries for all pairs over the past day. */
export async function fetchDaySummaries(): Promise<Serialized<SummaryWithPrices[]>> {
  // Kick off the fetching of the indexing asset.
  const indexingAssetP = indexingAsset();
  const registryP = getCachedRegistry(getClientSideEnv().PENUMBRA_CHAIN_ID);
  const data = await basicQuery('1d')
    .orderBy('liquidity', 'desc')
    .orderBy('volume', 'desc')
    .execute();
  const theIndexingAsset = await indexingAssetP;
  const registry = await registryP;
  return serialize(
    data
      .flatMap(x => {
        const start = new AssetId({ inner: x.asset_start });
        const end = new AssetId({ inner: x.asset_end });
        // Resolve on the server against the authoritative registry cache.
        // If either side is unknown here, the client would only fail
        // harder — drop the row and warn instead of shipping a raw
        // AssetId no consumer can render.
        const startAsset = registry.tryGetMetadata(start);
        const endAsset = registry.tryGetMetadata(end);
        if (!startAsset || !endAsset) {
          console.warn(
            '[fetchDaySummaries] dropping pair with unresolved asset(s):',
            !startAsset ? start.toJsonString() : end.toJsonString(),
          );
          return [];
        }
        if (!orderedCorrectly(registry, start, end)) {
          return [];
        }
        // Same guard as fetchSummary: a row with `price_then === 0` must
        // not render "Infinity%" on the explore pair cards.
        const priceThen = Number(x.price_then) || 0;
        const price = x.price;
        const priceChangePercent = priceThen > 0 ? 100 * (price / priceThen - 1.0) : 0;
        return [
          {
            startAsset,
            endAsset,
            liquidity: new Value({
              amount: pnum(x.liquidity ?? 0.0).toAmount(),
              assetId: theIndexingAsset,
            }),
            volume: new Value({
              amount: pnum(x.volume ?? 0.0).toAmount(),
              assetId: theIndexingAsset,
            }),
            price,
            priceChangePercent,
            priceDelta: price - priceThen,
            recentPrices: (x.recent_prices ?? []).flatMap((p, i) => {
              const startTime = (x.recent_dates ?? [])[i];
              if (!startTime) {
                return [];
              }
              return [[startTime, p] as [Date, number]];
            }),
            high: x.high,
            low: x.low,
          },
        ];
      }),
  );
}

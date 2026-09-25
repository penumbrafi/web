import { NextResponse } from 'next/server';
import { pindexer } from '@/shared/database';
import { serialize, Serialized } from '@/shared/utils/serializer';
import {
  AssetId,
  Metadata,
  ValueView,
} from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import { toValueView } from '@/shared/utils/value-view';
import { getStablecoins } from '@/shared/utils/stables';
import { referencePriceFor } from '@/shared/const/reference-price';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';

export interface PairData {
  baseAsset: Metadata;
  quoteAsset: Metadata;
  volume: ValueView;
}

export type PairsResponse = Serialized<PairData>[] | { error: string };

const EMPTY_PAIRS: PairsResponse = [];

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY_PAIRS,
  logTag: 'summary/pairs',
});

async function handleGet(): Promise<NextResponse<PairsResponse>> {
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    return NextResponse.json({ error: 'PENUMBRA_CHAIN_ID is not set' }, { status: 500 });
  }

  const registry = await withTimeout(
    getCachedRegistry(chainId),
    DEFAULT_TIMEOUT_MS,
    'summary/pairs registry.get',
  );
  const allAssets = registry.getAllAssets();

  const { stablecoins, usdc } = getStablecoins(allAssets, 'USDC');
  if (!usdc) {
    // Registry missing USDC for this chain — fall back to per-row quoteAsset
    // metadata below rather than 500'ing. The `$` prefix on the client will
    // still be approximate, but that matches pre-fix behavior.
    console.warn('[summary/pairs] USDC metadata not found in registry; volume ValueView will use quoteAsset metadata as a fallback');
  }

  const results = await withTimeout(
    pindexer.pairs({
      stablecoins: stablecoins.map(asset => asset.penumbraAssetId) as AssetId[],
    }),
    DEFAULT_TIMEOUT_MS,
    'summary/pairs pindexer.pairs',
  );

  // Collapse A/B and B/A of the same underlying market into a single
  // row: the volume shown adds up both directions' indexing-denom
  // volume, and the canonical direction is the one with more direct
  // volume in the window (the more natural quotation). Stable-quoted
  // pairs already come deduped from the DB (the query filters
  // asset_start NOT IN stablecoins), so this only matters for
  // non-stable/non-stable markets.
  const buckets = new Map<
    string,
    {
      canonicalStart: Buffer;
      canonicalEnd: Buffer;
      canonicalVolume: number;
      totalIndexingDenom: number;
    }
  >();
  for (const summary of results) {
    const startHex = summary.asset_start.toString('hex');
    const endHex = summary.asset_end.toString('hex');
    const key = startHex < endHex ? `${startHex}|${endHex}` : `${endHex}|${startHex}`;
    const vol = Math.max(summary.direct_volume_indexing_denom_over_window, 0);

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        canonicalStart: summary.asset_start,
        canonicalEnd: summary.asset_end,
        canonicalVolume: vol,
        totalIndexingDenom: vol,
      });
      continue;
    }
    existing.totalIndexingDenom += vol;
    if (vol > existing.canonicalVolume) {
      existing.canonicalStart = summary.asset_start;
      existing.canonicalEnd = summary.asset_end;
      existing.canonicalVolume = vol;
    }
  }

  const deduped = [...buckets.values()]
    .sort((a, b) => b.totalIndexingDenom - a.totalIndexingDenom)
    .slice(0, 15);

  // A symbol is "stable" iff REFERENCE_PRICES pegs it to a fixed $1.
  // pindexer's own stable filter (asset_start NOT IN stablecoins) only
  // knows the getStablecoins helper's list (bare USDT / USDC / USDY),
  // so bridged stables like USDC.inj and USDT.inj slip through as base.
  // Sourcing from REFERENCE_PRICES keeps this in sync with reference-price
  // intel — adding a new stable there auto-fixes canonical direction here.
  const isStableSymbol = (sym: string | undefined): boolean => {
    const src = referencePriceFor(sym);
    return src?.kind === 'fixed' && src.usd === 1;
  };

  const pairs = deduped
    .map(row => {
      let baseAsset = registry.tryGetMetadata(new AssetId({ inner: row.canonicalStart }));
      let quoteAsset = registry.tryGetMetadata(new AssetId({ inner: row.canonicalEnd }));
      if (!baseAsset || !quoteAsset) {return undefined;}

      // Never present stable-as-base: swap so risk asset is base and
      // the stable is the quote. This is the "correct" quotation
      // convention (USDC.inj/UM → UM/USDC.inj) regardless of which
      // direction happened to have more direct volume in the window.
      if (isStableSymbol(baseAsset.symbol) && !isStableSymbol(quoteAsset.symbol)) {
        [baseAsset, quoteAsset] = [quoteAsset, baseAsset];
      }

      // direct_volume_indexing_denom_over_window is denominated in the
      // chain's indexing numeraire (USDC), NOT in the pair's quote asset.
      // Attribute the ValueView to USDC so downstream formatters use the
      // correct exponent; only fall back to quoteAsset if USDC isn't in
      // the registry.
      const volume = toValueView({
        amount: Math.max(Math.floor(row.totalIndexingDenom), 0),
        metadata: usdc ?? quoteAsset,
      });

      return serialize({ baseAsset, quoteAsset, volume });
    })
    .filter((p): p is Serialized<PairData> => Boolean(p));

  return NextResponse.json(pairs);
}

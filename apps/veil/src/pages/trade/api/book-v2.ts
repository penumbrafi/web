import { useCallback, useEffect, useMemo, useState } from 'react';
import { InfiniteData, QueryKey, useInfiniteQuery } from '@tanstack/react-query';
import { useRefetchOnNewBlockBatch } from '@/shared/api/compact-block.ts';
import type { Trace } from '@/shared/api/server/book/types';
import type { BookV2ApiResponse, BookV2Response } from '@/shared/api/server/book/v2/types.ts';
import {
  type BookLevel,
  levelPriceString,
  stepForPct,
} from '@/shared/api/server/book/v2/levels.ts';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';

export interface BookV2PageParam {
  cursorBid?: number;
  cursorAsk?: number;
  /** Bucket width the first page resolved to; later pages must reuse it. */
  step?: number;
}

interface UseBookV2Options {
  /**
   * Bucket width as a percent of mid, snapped server-compatible (see
   * `snapStep`). `null` = raw prices, `undefined` = the server default
   * (~0.1%).
   */
  stepPct?: number | null;
  /** Levels per side per page. */
  levels?: number;
}

/**
 * v2 levels in the `Trace` shape the ladder/depth components already
 * render, with v1's ordering: `bids` DESCENDING (best first), `asks`
 * DESCENDING too (best ask LAST). `total` is PER-LEVEL here — the
 * components re-cumulate it (`accumulate`, `calculateCumulativeDepthByPrice`,
 * `buildDepthData`), so passing the server's cumulative total would square
 * the depth.
 */
export interface BookV2View {
  bids: Trace[];
  asks: Trace[];
  mid?: number;
  bestBid?: number;
  bestAsk?: number;
  step: number;
  hasMoreBids: boolean;
  hasMoreAsks: boolean;
}

// Mid each pair's step was last derived from. Module-scope so the ladder
// and depth tabs share it (switching tabs doesn't pay the extra first
// fetch again), and only moved when the price has really moved: the step
// is snapped anyway, so re-anchoring on every block would just churn.
const anchorMids = new Map<string, number>();
const REANCHOR_RATIO = 0.25;

const toTrace = (l: BookLevel, hops: string[]): Trace => ({
  price: levelPriceString(l.price),
  amount: levelPriceString(l.amount),
  total: levelPriceString(l.amount),
  hops,
});

/** Merge pages (deduping a level a moved book repeated) best-first per side. */
export const flattenBookPages = (
  pages: BookV2Response[],
  baseSymbol: string,
  quoteSymbol: string,
): BookV2View | undefined => {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (!first || !last) {
    return undefined;
  }
  const bids = new Map<number, BookLevel>();
  const asks = new Map<number, BookLevel>();
  for (const page of pages) {
    for (const l of page.bids) {
      if (!bids.has(l.price)) {
        bids.set(l.price, l);
      }
    }
    for (const l of page.asks) {
      if (!asks.has(l.price)) {
        asks.set(l.price, l);
      }
    }
  }
  // Every row is a direct position on this pair: no multi-hop routes in v2.
  const hops = [baseSymbol, quoteSymbol];
  return {
    bids: [...bids.values()].sort((a, b) => b.price - a.price).map(l => toTrace(l, hops)),
    asks: [...asks.values()].sort((a, b) => b.price - a.price).map(l => toTrace(l, hops)),
    mid: first.mid ?? undefined,
    bestBid: first.bestBid ?? undefined,
    bestAsk: first.bestAsk ?? undefined,
    step: first.step,
    hasMoreBids: last.nextCursorBid !== undefined,
    hasMoreAsks: last.nextCursorAsk !== undefined,
  };
};

/**
 * Next page's cursors. A side that is exhausted keeps its last price as the
 * cursor (the server then returns nothing more for it) rather than dropping
 * the cursor, which would replay that side's first page.
 */
export const nextBookPageParam = (
  lastPage: BookV2Response,
  lastPageParam: BookV2PageParam,
): BookV2PageParam | undefined => {
  if (lastPage.nextCursorBid === undefined && lastPage.nextCursorAsk === undefined) {
    return undefined;
  }
  return {
    step: lastPage.step,
    cursorBid:
      lastPage.nextCursorBid ??
      lastPage.bids[lastPage.bids.length - 1]?.price ??
      lastPageParam.cursorBid,
    cursorAsk:
      lastPage.nextCursorAsk ??
      lastPage.asks[lastPage.asks.length - 1]?.price ??
      lastPageParam.cursorAsk,
  };
};

const fetchBookPage = async (
  baseSymbol: string,
  quoteSymbol: string,
  levels: number | undefined,
  step: number | undefined,
  param: BookV2PageParam,
  signal: AbortSignal,
): Promise<BookV2Response> => {
  const params = new URLSearchParams({ baseAsset: baseSymbol, quoteAsset: quoteSymbol });
  if (levels !== undefined) {
    params.set('levels', String(levels));
  }
  const pageStep = param.step ?? step;
  if (pageStep !== undefined) {
    params.set('step', String(pageStep));
  }
  if (param.cursorBid !== undefined) {
    params.set('cursorBid', String(param.cursorBid));
  }
  if (param.cursorAsk !== undefined) {
    params.set('cursorAsk', String(param.cursorAsk));
  }
  // `no-cache` is load-bearing: it makes the browser ALWAYS revalidate with
  // the stored ETag and reuse the cached body only on a 304. With the default
  // mode, the response's stale-while-revalidate window (1-6s old) covers the
  // ~5.4s block refetch, so every poll would get the PREVIOUS block's page.
  const res = await fetch(`/api/book/v2?${params.toString()}`, { signal, cache: 'no-cache' });
  const json = (await res.json()) as BookV2ApiResponse;
  if ('error' in json) {
    throw new Error(json.error);
  }
  return json;
};

/**
 * The order book around the current price, paged outward on demand. One
 * infinite query per (pair, step, levels); both sides advance together, so
 * "load more" on either end is `loadMore()`. Refetches every block; the
 * server's ETag turns an unchanged book into a 304.
 */
export const useBookV2 = ({ stepPct, levels }: UseBookV2Options = {}) => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();
  const pairKey = `${baseSymbol}|${quoteSymbol}`;
  const [anchor, setAnchor] = useState<number | undefined>(() => anchorMids.get(pairKey));
  useEffect(() => {
    setAnchor(anchorMids.get(pairKey));
  }, [pairKey]);

  let step: number | undefined;
  if (stepPct === null) {
    step = 0;
  } else if (stepPct !== undefined && anchor !== undefined) {
    step = stepForPct(anchor, stepPct);
  }

  const enabled = Boolean(baseSymbol) && Boolean(quoteSymbol);
  const queryKey: QueryKey = ['bookV2', baseSymbol, quoteSymbol, step, levels];
  const query = useInfiniteQuery<
    BookV2Response,
    Error,
    InfiniteData<BookV2Response, BookV2PageParam>,
    QueryKey,
    BookV2PageParam
  >({
    queryKey,
    enabled,
    initialPageParam: {},
    queryFn: ({ pageParam, signal }) =>
      fetchBookPage(baseSymbol, quoteSymbol, levels, step, pageParam, signal),
    getNextPageParam: (lastPage, _all, lastPageParam) => nextBookPageParam(lastPage, lastPageParam),
    // Keep showing the same pair's book while a new step/levels key loads
    // (no skeleton flash on an Agg change), but never another pair's.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === baseSymbol && prevQuery.queryKey[2] === quoteSymbol
        ? prev
        : undefined,
  });

  const firstMid = query.data?.pages[0]?.mid ?? undefined;
  useEffect(() => {
    if (firstMid === undefined || !(firstMid > 0)) {
      return;
    }
    const current = anchorMids.get(pairKey);
    if (current === undefined || Math.abs(firstMid / current - 1) > REANCHOR_RATIO) {
      anchorMids.set(pairKey, firstMid);
      setAnchor(firstMid);
    }
  }, [firstMid, pairKey]);

  useRefetchOnNewBlockBatch([{ queryKey, refetch: query.refetch }], !enabled);

  const data = useMemo(
    () => (query.data ? flattenBookPages(query.data.pages, baseSymbol, quoteSymbol) : undefined),
    [query.data, baseSymbol, quoteSymbol],
  );

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return {
    data,
    isLoading: query.isLoading,
    error: query.error,
    loadMore,
    isFetchingMore: isFetchingNextPage,
  };
};

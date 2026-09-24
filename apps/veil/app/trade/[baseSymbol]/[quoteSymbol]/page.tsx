import { Suspense } from 'react';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { NextRequest } from 'next/server';
import { TradePage } from '@/pages/trade';
import { deserializeRouteBookResponseJson } from '@/shared/api/server/book/serialization';
import { GET as getBook, RouteBookApiResponse } from '@/shared/api/server/book';

interface Params {
  baseSymbol: string;
  quoteSymbol: string;
}

/**
 * Server Component wrapper for the trade page.
 *
 * The page shell must NEVER wait on the book. This used to `await` the book
 * prefetch before returning anything, so when pd was slow every visitor
 * stared at a blank page for the prefetch's full 2.5s budget, even though
 * the client fetches the book itself anyway.
 *
 * Now `TradePage` renders and streams immediately, and the prefetch runs
 * inside its own Suspense boundary. When it resolves (usually a ~5ms cache
 * hit, since /api/book computes each pair once per block) its
 * HydrationBoundary streams in and seeds the React Query cache under the
 * key `useBook` uses. If the client's own fetch got there first, hydration
 * only replaces it when the streamed data is newer. If the prefetch fails
 * or times out, it renders nothing and the client fetch carries on.
 *
 * `TradePage` itself stays `'use client'`: the ResizableSplit / useViewport
 * / mobx observers all need the client tree.
 */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { baseSymbol, quoteSymbol } = await params;

  return (
    <>
      <TradePage />
      <Suspense fallback={null}>
        <BookPrefetch baseSymbol={baseSymbol} quoteSymbol={quoteSymbol} />
      </Suspense>
    </>
  );
}

async function BookPrefetch({ baseSymbol, quoteSymbol }: Params) {
  const qc = new QueryClient();
  await prefetchBook(qc, baseSymbol, quoteSymbol);
  return <HydrationBoundary state={dehydrate(qc)}>{null}</HydrationBoundary>;
}

async function prefetchBook(qc: QueryClient, baseSymbol: string, quoteSymbol: string) {
  // Call the book route IN-PROCESS. This used to fetch its own public URL,
  // which from the app host means a round trip out through the CDN, and
  // the host's IPv6 egress is broken, so it hit the 2.5s budget and failed
  // on every render. The URL's origin is irrelevant here; only the query
  // string is read. The route's per-block cache makes this ~free.
  try {
    const url = `http://localhost/api/book?baseAsset=${encodeURIComponent(baseSymbol)}&quoteAsset=${encodeURIComponent(quoteSymbol)}`;
    const res = await Promise.race([
      getBook(new NextRequest(url, { signal: AbortSignal.timeout(2_500) })),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('book prefetch timeout')), 2_500);
      }),
    ]);
    if (!res.ok || res.headers.get('X-Book-Fallback') === 'empty') {
      return;
    }
    const json = (await res.json()) as RouteBookApiResponse;
    if ('error' in json) {
      return;
    }
    // Same key the client's `useBook` uses. Default (undefined) traceLimit —
    // matches useMarketPrice/depth-overlay.
    qc.setQueryData(['book', baseSymbol, quoteSymbol, undefined], deserializeRouteBookResponseJson(json));
  } catch {
    // Never break the trade page on prefetch failure — the client fetches
    // normally.
  }
}

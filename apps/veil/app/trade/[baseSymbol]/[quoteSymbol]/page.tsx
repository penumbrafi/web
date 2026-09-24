import { Suspense } from 'react';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { TradePage } from '@/pages/trade';
import { deserializeRouteBookResponseJson } from '@/shared/api/server/book/serialization';
import { RouteBookApiResponse } from '@/shared/api/server/book';

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
  // Same-origin fetch from the server component. Next 16 dedupes and
  // this executes within the request context, so `pindexer_stream` and
  // pd calls made during handleGet run in the same isolate. `headers()`
  // gives us the request's own origin so we don't hard-code a URL.
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'http';
    if (!host) return;
    const url = `${proto}://${host}/api/book?baseAsset=${encodeURIComponent(baseSymbol)}&quoteAsset=${encodeURIComponent(quoteSymbol)}`;
    // Prefetch under the same key the client's `useBook` uses. Default
    // (undefined) traceLimit — matches useMarketPrice/depth-overlay.
    // Time-boxed; it runs inside a Suspense boundary, so this only bounds
    // how long the stream stays open, never the first paint.
    const res = await fetch(url, {
      // Server-render this specific request; the internal /api/book
      // has its own 6s SWR cache so Next's fetch cache would only
      // duplicate that layer. Keep it simple.
      cache: 'no-store',
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return;
    const json = (await res.json()) as RouteBookApiResponse;
    if ('error' in json) return;
    qc.setQueryData(['book', baseSymbol, quoteSymbol, undefined], deserializeRouteBookResponseJson(json));
  } catch {
    // Never break the trade page on prefetch failure — client fetches
    // normally as before.
  }
}

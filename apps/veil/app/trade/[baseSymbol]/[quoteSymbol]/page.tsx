import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
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
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { baseSymbol, quoteSymbol } = await params;
  const pair = `${decodeURIComponent(baseSymbol)}/${decodeURIComponent(quoteSymbol)}`;
  return {
    title: `${pair} · Trade`,
    description: `Trade ${pair} privately on Penumbra: shielded orders and liquidity positions.`,
    alternates: { canonical: `/trade/${baseSymbol}/${quoteSymbol}` },
  };
}

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
  // Ask THIS server process over loopback. Two approaches that looked
  // simpler both failed in production:
  // - fetching the public URL goes out through the CDN, and the app host's
  //   IPv6 egress is broken, so it hit the budget and failed on every render;
  // - importing the route handler and calling it in-process gets a separate
  //   module instance in the page bundle, with its own cold book cache, so
  //   every render started its own pd simulate (then cancelled it).
  // Loopback reaches the route's real per-block cache: a ~3ms hit.
  const port = process.env['PORT'] ?? '3000';
  try {
    const url = `http://127.0.0.1:${port}/api/book?baseAsset=${encodeURIComponent(baseSymbol)}&quoteAsset=${encodeURIComponent(quoteSymbol)}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2_500) });
    if (!res.ok || res.headers.get('X-Book-Fallback') === 'empty') {
      return;
    }
    const json = (await res.json()) as RouteBookApiResponse;
    if ('error' in json) {
      return;
    }
    // Same key the client's `useBook` uses. Default (undefined) traceLimit —
    // matches useMarketPrice/depth-overlay.
    qc.setQueryData(
      ['book', baseSymbol, quoteSymbol, undefined],
      deserializeRouteBookResponseJson(json),
    );
  } catch {
    // Never break the trade page on prefetch failure — the client fetches
    // normally.
  }
}

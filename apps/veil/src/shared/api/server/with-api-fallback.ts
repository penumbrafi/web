import { NextResponse } from 'next/server';

// Shared graceful-degradation wrapper for server route handlers.
//
// Without this, an upstream failure (pd unreachable, ChainRegistryClient
// timing out, pindexer connection reset, cometbft down) propagates as a
// thrown error out of the route handler. Next.js turns that into a 500,
// nginx in front of it turns *that* into a 502, and the client's fetch
// then throws into whatever called it -- which, for most of veil's data
// hooks, is a React Query hook with no error boundary underneath it,
// so the whole page unmounts into the top-level ErrorBoundary (React
// error #300 in production builds).
//
// Wrapping a handler in `withApiFallback` makes failures degrade instead:
// the client always gets a 200 with a body shaped exactly like the
// success response (an empty list, an empty object with the same keys),
// tagged with `X-Fallback: empty` so it's visible in the network tab /
// logs that this was a degraded response and not real data. The calling
// UI, which already has to handle "no data yet" states, renders its
// empty state instead of crashing.
export interface FallbackConfig<T> {
  // The response body to serve when the wrapped handler throws. This is
  // the SHAPE the client's deserializer expects -- an empty array for
  // lists, an empty object with the same top-level keys for structured
  // responses.
  emptyResponse: T;
  // Included in the console.error so failures from different routes are
  // easy to tell apart in logs.
  logTag: string;
}

export const withApiFallback =
  <TArgs extends unknown[], T>(
    handler: (...args: TArgs) => Promise<NextResponse<T>>,
    cfg: FallbackConfig<T>,
  ) =>
  async (...args: TArgs): Promise<NextResponse<T>> => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`[${cfg.logTag}] handler failed, serving empty fallback`, err);
      return NextResponse.json(cfg.emptyResponse, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Fallback': 'empty',
        },
      });
    }
  };

// Bounds a single outbound call (pd, registry, pindexer, cometbft, ...) so a
// hanging upstream can't pin a request slot indefinitely. Rejects with an
// Error after `ms`; callers let that rejection propagate up to
// `withApiFallback`, which turns it into the empty-response fallback.
export const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (handle) {
      clearTimeout(handle);
    }
  });
};

export const DEFAULT_TIMEOUT_MS = 5_000;

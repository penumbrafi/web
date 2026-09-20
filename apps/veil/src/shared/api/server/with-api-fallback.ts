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

// Timing instrumentation. Every wrapped route gets an `X-Served-Ms`
// response header (wall time inside the handler, fallback path included)
// so route latency can be read straight off the network tab / nginx
// access log in prod. A log line is emitted when the request is slow
// (>= SLOW_MS) or always when `VEIL_API_TIMING=1` — /api/book fires every
// ~6s per client, so unconditional logging would drown the journal.
const SLOW_MS = 1_000;
const LOG_ALL_TIMING = process.env['VEIL_API_TIMING'] === '1';

const stamp = (res: NextResponse, tag: string, startedAt: number, outcome: 'ok' | 'fallback') => {
  const ms = Math.round(performance.now() - startedAt);
  try {
    res.headers.set('X-Served-Ms', String(ms));
  } catch {
    // Immutable headers (shouldn't happen for handler-built responses).
  }
  if (LOG_ALL_TIMING || ms >= SLOW_MS || outcome === 'fallback') {
    console.debug(`[${tag}] served in ${ms}ms`, { outcome, status: res.status });
  }
  return res;
};

export const withApiFallback =
  <TArgs extends unknown[], T>(
    handler: (...args: TArgs) => Promise<NextResponse<T>>,
    cfg: FallbackConfig<T>,
  ) =>
  async (...args: TArgs): Promise<NextResponse<T>> => {
    const startedAt = performance.now();
    try {
      return stamp(await handler(...args), cfg.logTag, startedAt, 'ok');
    } catch (err) {
      console.error(`[${cfg.logTag}] handler failed, serving empty fallback`, err);
      return stamp(
        NextResponse.json(cfg.emptyResponse, {
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
            'X-Fallback': 'empty',
          },
        }),
        cfg.logTag,
        startedAt,
        'fallback',
      );
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

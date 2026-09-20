'use client';

import { useEffect } from 'react';
import { queryClient } from '@/shared/const/queryClient';

/**
 * Client-side subscriber for the server's /api/pindexer-stream SSE endpoint.
 *
 * Every `pindexer_tick` NOTIFY from the pindexer database is fanned out
 * to the browser as an SSE frame. This module holds ONE EventSource for
 * the whole tab (shared across every hook that wants ticks), parses the
 * JSON payload, and dispatches to registered listeners.
 *
 * Consumers use `useOnPindexerTick(indexers, invalidateKey)` to hook a
 * React-Query cache invalidation to a specific indexer's ticks. This
 * replaces the old poll-shaped "refetch every block" pattern for panels
 * that source their data from pindexer.
 */

export interface PindexerTick {
  indexer: string;
  height: number;
}

type Listener = (tick: PindexerTick) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let refCount = 0;
// Exponential-backoff reconnect state. When the server returns the
// `X-Fallback: empty` stream (indexer DB unreachable) it closes
// immediately; the browser's default 3s auto-reconnect would then hammer
// the API. Track a delay that grows on each consecutive close and
// resets on a successful `tick`.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const parse = (raw: string): PindexerTick | null => {
  try {
    const obj = JSON.parse(raw) as { indexer?: unknown; height?: unknown };
    if (typeof obj.indexer !== 'string' || typeof obj.height !== 'number') {
      return null;
    }
    return { indexer: obj.indexer, height: obj.height };
  } catch {
    return null;
  }
};

const ensureConnected = () => {
  if (source) return;
  const es = new EventSource('/api/pindexer-stream');
  es.addEventListener('tick', ev => {
    // A live tick means the upstream is healthy — reset backoff so the
    // next transient close reconnects quickly.
    reconnectDelayMs = 1_000;
    const tick = parse((ev as MessageEvent).data as string);
    if (!tick) return;
    for (const fn of listeners) {
      try {
        fn(tick);
      } catch {
        // never let one listener kill the fanout
      }
    }
  });
  es.onerror = () => {
    // EventSource's default auto-reconnect fires ~3s after every close.
    // When the server's serving its `X-Fallback: empty` stream (indexer
    // DB unreachable) that closes immediately, so unchecked auto-reconnect
    // hammers /api/pindexer-stream every ~3s per open tab indefinitely.
    // Close ours + reopen on an exponential backoff instead. Reset
    // happens on the next successful `tick`.
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      if (source === es) source = null;
      if (refCount > 0 && !reconnectTimer) {
        const delay = reconnectDelayMs;
        // eslint-disable-next-line no-console
        console.warn(`[pindexer-stream] connection closed; retrying in ${delay}ms`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
          ensureConnected();
        }, delay);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[pindexer-stream] connection error; browser will auto-reconnect');
    }
  };
  source = es;
};

const teardownIfIdle = () => {
  if (refCount > 0 || !source) {
    // Nothing to close, but cancel a pending reconnect if we're now idle
    // — otherwise the tab holds a timer that reconnects to nobody.
    if (refCount <= 0 && reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    return;
  }
  source.close();
  source = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const subscribe = (fn: Listener): (() => void) => {
  refCount += 1;
  ensureConnected();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    refCount -= 1;
    if (refCount <= 0) teardownIfIdle();
  };
};

/**
 * Invalidate the given React-Query key on every tick from any of
 * `indexers`. Panels that were previously wired through
 * `useRefetchOnNewBlock` should migrate to this: instead of "refetch
 * when the chain advances a block", it becomes "refetch when the
 * pindexer commit that matters for this panel lands". Sub-second lag
 * from row commit to browser refetch, no polling on any hop.
 *
 * Example:
 *   useOnPindexerTick(['dex_ex'], ['recent-executions', baseSymbol, quoteSymbol]);
 *
 * A stable stringification of `queryKey` is used as the effect dep so
 * arrays with the same contents don't re-subscribe on every render.
 */
export const useOnPindexerTick = (
  indexers: readonly string[],
  queryKey: readonly unknown[],
): void => {
  const indexersKey = indexers.join(',');
  const queryKeyString = JSON.stringify(queryKey);
  useEffect(() => {
    const wanted = new Set(indexers);
    const unsub = subscribe(tick => {
      if (!wanted.has(tick.indexer)) return;
      void queryClient.invalidateQueries({ queryKey: queryKey as unknown[] });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexersKey, queryKeyString]);
};

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
    // Browsers auto-reconnect EventSource with backoff; nothing to do.
    // Log so a persistent breakage surfaces in devtools.
    // eslint-disable-next-line no-console
    console.warn('[pindexer-stream] connection error; auto-reconnecting');
  };
  source = es;
};

const teardownIfIdle = () => {
  if (refCount > 0 || !source) return;
  source.close();
  source = null;
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

'use client';

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { CompactBlockService, TendermintProxyService } from '@penumbra-zone/protobuf';
import { createClient, Transport } from '@connectrpc/connect';
import { errorIsStreamAbort, useStream } from '@/shared/use-stream.ts';
import { useCallback, useEffect, useRef } from 'react';
import { queryClient } from '@/shared/const/queryClient.ts';
import { usePublicGrpcTransport } from '@/shared/api/transport.ts';

const fetchLatestBlockHeight = async (transport: Transport) => {
  const tendermintClient = createClient(TendermintProxyService, transport);
  const { syncInfo } = await tendermintClient.getStatus({});
  if (!syncInfo?.latestBlockHeight) {
    throw new Error('Was not able to sync latest block height');
  }
  return Number(syncInfo.latestBlockHeight);
};

// Reconnect delays for the compact-block stream on non-abort errors —
// exponential-ish with a ceiling so long outages don't hammer the veil
// endpoint and short blips (deadline_exceeded, transient TLS resets)
// recover fast enough that a trader mid-order barely notices.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

const startBlockHeightStream = async (transport: Transport, signal: AbortSignal) => {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const latestBlockHeight = await fetchLatestBlockHeight(transport);
      // The initial status fetch is a real height too — previously the
      // `useLatestBlockHeight` query supplied consumers' first tick, so
      // keep feeding it through the same imperative path.
      notifyNewBlock(latestBlockHeight);
      const blockClient = createClient(CompactBlockService, transport);
      for await (const response of blockClient.compactBlockRange(
        {
          startHeight: BigInt(latestBlockHeight) + 1n,
          keepAlive: true,
        },
        { signal },
      )) {
        if (response.compactBlock?.height) {
          const newHeight = Number(response.compactBlock.height);
          queryClient.setQueryData(LATEST_HEIGHT_QUERY_KEY, newHeight);
          notifyNewBlock(newHeight);
          // Reset backoff after we successfully receive a block —
          // otherwise a stream that survived one hiccup would still
          // wait 30s to retry the next.
          attempt = 0;
        }
      }
    } catch (error) {
      if (errorIsStreamAbort(error)) {
        return;
      }
      const delay =
        RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
      console.warn(`[compact-block] stream ended (${String(error)}); reconnecting in ${delay}ms`);
      attempt++;
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
      continue;
    }
    // The for-await exited without an error (server closed the stream
    // cleanly, e.g. LB rebind). Loop back and reconnect immediately.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aborted can flip during the await above; TS narrowed it from an earlier check
    if (signal.aborted) {
      return;
    }
  }
};

/*
 * Imperative block-tick fanout.
 *
 * `useRefetchOnNewBlock` used to read `useLatestBlockHeight()` — a
 * `useQuery` — inside every consumer's render, so all ~13 per-block queries
 * on the trade page re-rendered their host component on every height tick
 * AND again on their own data. Now consumers register `{key, refetch}` in
 * this module-level map from an effect, and the compact-block stream walks
 * the map when a block lands (the same shape `useOnPindexerTick` uses).
 * Consumers become effect-only: no render on the height tick at all.
 */
type Refetch = (opts?: { cancelRefetch?: boolean }) => unknown;

const refetchers = new Map<string, Set<Refetch>>();
// Per-key dedup: instances sharing a query key share the underlying query,
// so one refetch per key per height is enough (and is what the old
// first-instance-wins effect ordering amounted to).
const lastRefetchedBlockHeights = new Map<string, number>();
let latestKnownHeight: number | undefined;

const firstOf = (set: Set<Refetch> | undefined): Refetch | undefined => {
  const next = set?.values().next();
  return next && !next.done ? next.value : undefined;
};

const refetchKeyIfStale = (key: string, height: number) => {
  const lastHeight = lastRefetchedBlockHeights.get(key) ?? -1;
  if (height <= lastHeight) {
    return;
  }
  const refetch = firstOf(refetchers.get(key));
  if (!refetch) {
    return;
  }
  lastRefetchedBlockHeights.set(key, height);
  // Join a fetch already in flight instead of restarting it. With the
  // default (cancel), any query slower than a block - e.g. a wallet with
  // hundreds of LP positions - was cancelled by every new block and never
  // finished.
  void refetch({ cancelRefetch: false });
};

const notifyNewBlock = (height: number) => {
  if (latestKnownHeight !== undefined && height <= latestKnownHeight) {
    return;
  }
  latestKnownHeight = height;
  for (const key of refetchers.keys()) {
    refetchKeyIfStale(key, height);
  }
};

const registerRefetch = (key: string, refetch: Refetch): (() => void) => {
  let set = refetchers.get(key);
  if (!set) {
    set = new Set();
    refetchers.set(key, set);
  }
  set.add(refetch);
  // A consumer mounting mid-session used to see the cached height right
  // away and refetch once on mount; preserve that.
  const known = latestKnownHeight ?? queryClient.getQueryData<number>(LATEST_HEIGHT_QUERY_KEY);
  if (known !== undefined) {
    refetchKeyIfStale(key, known);
  }
  return () => {
    set.delete(refetch);
    if (set.size === 0) {
      refetchers.delete(key);
    }
  };
};

/**
 * Keep the shared compact-block stream alive while the caller is mounted.
 * Shared by `useLatestBlockHeight` (which also exposes the height as query
 * data) and `useRefetchOnNewBlock` (which only wants the ticks). The
 * transport query is `staleTime: Infinity`, so this does not tick per block.
 */
const useBlockHeightStream = () => {
  // Public transport on purpose: the chain tip is the same for everyone, and
  // a wallet whose proxy mishandles server streams used to leave every
  // per-block refresh dead ("not async iterable") the moment it connected.
  const { data, isLoading, error } = usePublicGrpcTransport();

  // Memoized for use in useStream
  const streamFn = useCallback(
    (signal: AbortSignal) => {
      if (!data?.transport) {
        throw new Error('Transport not available');
      }
      return startBlockHeightStream(data.transport, signal);
    },
    [data?.transport],
  );

  useStream({
    id: 'compactBlockStream',
    enabled: !!data?.transport,
    streamFn,
    // Rebind the shared stream when the transport itself changes (connection
    // flip) - otherwise the stream can keep running on a dead transport and
    // block ticks stop, freezing price/book/balances until a manual reload.
    // All consumers get the same transport object, so this rebinds exactly once.
    resubscribeKey: data?.transport,
  });

  return { transport: data?.transport, isLoading, error };
};

export const useRefetchOnNewBlock = (
  queryKey: unknown,
  { refetch }: UseQueryResult,
  disabled?: boolean,
) => {
  useBlockHeightStream();

  // JSON.stringify on a string queryKey produces a wasteful '"x"' wrapper
  // allocation per render — short-circuit when it's already a string (the
  // common case) and only stringify for object/array keys.
  const queryKeyString = typeof queryKey === 'string' ? queryKey : JSON.stringify(queryKey);

  useEffect(() => {
    if (disabled) {
      return;
    }
    // `refetch` is bound once on the RQ observer, so this only re-registers
    // when the key or the disabled flag changes.
    return registerRefetch(queryKeyString, refetch);
  }, [refetch, queryKeyString, disabled]);
};

/**
 * Batch counterpart of {@link useRefetchOnNewBlock}: registers every entry's
 * refetch under its own query key in a single effect. Hooks cannot be looped,
 * but `registerRefetch` can — so a dynamic list of queries (e.g. the
 * `useQueries` result backing the portfolio's per-pair books) gets the same
 * per-key block-tick dedup without N hook stacks.
 */
export const useRefetchOnNewBlockBatch = (
  entries: { queryKey: unknown; refetch: () => unknown }[],
  disabled?: boolean,
) => {
  useBlockHeightStream();

  // `entries` identity changes every render (useQueries returns a fresh
  // array). Register against a serialized signature and read the latest
  // entries through a ref, so the effect only re-runs when the key set moves.
  const signature = entries
    .map(entry =>
      typeof entry.queryKey === 'string' ? entry.queryKey : JSON.stringify(entry.queryKey),
    )
    .join('\u0000');
  const latest = useRef(entries);
  latest.current = entries;

  useEffect(() => {
    if (disabled) {
      return;
    }
    const unsubscribes = latest.current.map(entry =>
      registerRefetch(
        typeof entry.queryKey === 'string' ? entry.queryKey : JSON.stringify(entry.queryKey),
        entry.refetch,
      ),
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [signature, disabled]);
};

export const LATEST_HEIGHT_QUERY_KEY = ['latestBlockHeight'];

export const useLatestBlockHeight = () => {
  const {
    transport,
    isLoading: transportIsLoading,
    error: transportError,
  } = useBlockHeightStream();

  const res = useQuery({
    queryKey: LATEST_HEIGHT_QUERY_KEY,
    queryFn: async (): Promise<number> => {
      if (!transport) {
        throw new Error('Transport not available');
      }
      return await fetchLatestBlockHeight(transport);
    },
    staleTime: Infinity,
    enabled: !!transport,
  });

  return {
    ...res,
    isLoading: transportIsLoading || res.isLoading,
    error: transportError ?? res.error,
  };
};

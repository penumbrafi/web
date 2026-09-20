'use client';

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { CompactBlockService, TendermintProxyService } from '@penumbra-zone/protobuf';
import { createClient, Transport } from '@connectrpc/connect';
import { errorIsStreamAbort, useStream } from '@/shared/use-stream.ts';
import { useCallback, useEffect } from 'react';
import { queryClient } from '@/shared/const/queryClient.ts';
import { useGrpcTransport } from '@/shared/api/transport.ts';

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
      if (errorIsStreamAbort(error)) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
      console.warn(
        `[compact-block] stream ended (${String(error)}); reconnecting in ${delay}ms`,
      );
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
    if (signal.aborted) return;
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
type Refetch = () => unknown;

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
  void refetch();
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
  const { data, isLoading, error } = useGrpcTransport();

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
  const queryKeyString =
    typeof queryKey === 'string' ? queryKey : JSON.stringify(queryKey);

  useEffect(() => {
    if (disabled) {
      return;
    }
    // `refetch` is bound once on the RQ observer, so this only re-registers
    // when the key or the disabled flag changes.
    return registerRefetch(queryKeyString, refetch);
  }, [refetch, queryKeyString, disabled]);
};

export const LATEST_HEIGHT_QUERY_KEY = ['latestBlockHeight'];

export const useLatestBlockHeight = () => {
  const { transport, isLoading: transportIsLoading, error: transportError } =
    useBlockHeightStream();

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

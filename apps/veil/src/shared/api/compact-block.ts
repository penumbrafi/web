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

const lastRefetchedBlockHeights = new Map<string, number>();

export const useRefetchOnNewBlock = (
  queryKey: unknown,
  { refetch }: UseQueryResult,
  disabled?: boolean,
) => {
  const { data: blockHeight } = useLatestBlockHeight();

  // useLatestBlockHeight ticks every block (~5s), which fires this hook
  // across every per-block query (book, candles, swaps, ...) on the trade
  // page. JSON.stringify on a string queryKey produces a wasteful '"x"'
  // wrapper allocation per render — short-circuit when it's already a
  // string (the common case) and only stringify for object/array keys.
  const queryKeyString =
    typeof queryKey === 'string' ? queryKey : JSON.stringify(queryKey);

  useEffect(() => {
    if (!blockHeight || disabled) {
      return;
    }

    const lastHeight = lastRefetchedBlockHeights.get(queryKeyString) ?? -1;
    if (blockHeight > lastHeight) {
      lastRefetchedBlockHeights.set(queryKeyString, blockHeight);
      void refetch();
    }
  }, [blockHeight, refetch, queryKeyString, disabled]);
};

export const LATEST_HEIGHT_QUERY_KEY = ['latestBlockHeight'];

export const useLatestBlockHeight = () => {
  const { data, isLoading: transportIsLoading, error: transportError } = useGrpcTransport();

  const res = useQuery({
    queryKey: LATEST_HEIGHT_QUERY_KEY,
    queryFn: async (): Promise<number> => {
      if (!data?.transport) {
        throw new Error('Transport not available');
      }
      return await fetchLatestBlockHeight(data.transport);
    },
    staleTime: Infinity,
    enabled: !!data?.transport,
  });

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

  return {
    ...res,
    isLoading: transportIsLoading || res.isLoading,
    error: transportError ?? res.error,
  };
};

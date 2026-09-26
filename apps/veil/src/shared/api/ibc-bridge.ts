import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/shared/utils/api-fetch';
import type { IbcBridgeResponse } from '@/shared/api/server/ibc-bridge';

/**
 * Channel ids (`channel-N`) whose IBC client is expired or frozen. Read
 * straight off an asset's base denom with `channelOfBaseDenom`, this is what
 * makes the "Bridge closed" badge chain-state-driven instead of a
 * hand-maintained symbol list.
 */
export type PausedChannels = ReadonlySet<string>;

// Stable empty value: returning a fresh `new Set()` while the query is in
// flight would bust the `useMemo` deps of every consumer that sorts on this.
const NONE: PausedChannels = new Set();

export const usePausedChannels = (): PausedChannels => {
  const { data } = useQuery({
    queryKey: ['ibc-bridge'],
    queryFn: () => apiFetch<IbcBridgeResponse>('/api/ibc-bridge'),
    // Channel expiry is a minutes-scale event and the route is already cached
    // server-side for a minute; re-asking on every page navigation would be
    // pure churn.
    staleTime: 5 * 60_000,
  });

  return useMemo(
    () => (data?.pausedChannels.length ? new Set(data.pausedChannels) : NONE),
    [data],
  );
};
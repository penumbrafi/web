import { DexService, ViewService } from '@penumbra-zone/protobuf';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Position,
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { queryClient } from '@/shared/const/queryClient';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block';

// Positions per liquidityPositionsById call, and how many calls run at once.
const CHUNK = 50;
const PARALLEL = 4;

const WITHDRAWN = PositionState_PositionStateEnum.WITHDRAWN;

/**
 * Every position this wallet ever owned in `subaccount`, by bech32 id. Kept
 * per subaccount for the session (memory only: the list of your positions is
 * private and does not belong in localStorage).
 *
 * A refresh fetches only what can have changed. A withdrawn position is final
 * and is never fetched again; open and closed ones are re-read, new ids are
 * read once. Each Position object is kept when it didn't change, so rows keyed
 * on it skip re-rendering. Every tab (open, closed, history) and the chart
 * overlays read this one map and filter it, instead of each streaming its own
 * copy from scratch.
 */
interface PositionCache {
  byId: Map<string, Position>;
  /** The map last returned, reused when nothing changed. */
  last?: Map<string, Position>;
}
const caches = new Map<number, PositionCache>();

const cacheFor = (subaccount: number): PositionCache => {
  let c = caches.get(subaccount);
  if (!c) {
    c = { byId: new Map() };
    caches.set(subaccount, c);
  }
  return c;
};

const fetchOwnedIds = async (subaccount: number): Promise<PositionId[]> => {
  const res = await Array.fromAsync(
    penumbra.service(ViewService).ownedPositionIds({
      subaccount: new AddressIndex({ account: subaccount }),
    }),
  );
  return res.map(item => item.positionId).filter(Boolean) as PositionId[];
};

const fetchChunk = async (ids: PositionId[]): Promise<[string, Position][]> => {
  const res = await Array.fromAsync(
    penumbra.service(DexService).liquidityPositionsById({ positionId: ids }),
  );
  if (res.length !== ids.length) {
    throw new Error('owned id array does not match the length of the positions response');
  }
  const out: [string, Position][] = [];
  // Responses come back in request order, hence the index match.
  res.forEach((r, i) => {
    const id = ids[i];
    if (id && r.data) {
      out.push([bech32mPositionId(id), r.data]);
    }
  });
  return out;
};

const fetchInParallel = async (ids: PositionId[]): Promise<[string, Position][]> => {
  const chunks: PositionId[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(ids.slice(i, i + CHUNK));
  }
  const results = new Array<[string, Position][]>(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      const chunk = chunks[index];
      if (chunk) {
        results[index] = await fetchChunk(chunk);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
  return results.flat();
};

const refreshPositions = async (subaccount: number): Promise<Map<string, Position>> => {
  const cache = cacheFor(subaccount);
  const ids = await fetchOwnedIds(subaccount);
  const stale = ids.filter(id => {
    const known = cache.byId.get(bech32mPositionId(id));
    return !known || known.state?.state !== WITHDRAWN;
  });
  for (const [id, position] of await fetchInParallel(stale)) {
    const known = cache.byId.get(id);
    if (!known?.equals(position)) {
      cache.byId.set(id, position);
    }
  }
  // Owned-id order, so rows keep a stable order across refreshes.
  const out = new Map<string, Position>();
  for (const id of ids) {
    const key = bech32mPositionId(id);
    const position = cache.byId.get(key);
    if (position) {
      out.set(key, position);
    }
  }
  // Same positions (by reference) in the same order: hand back the previous
  // map, so a block with no fills re-renders nothing downstream.
  const last = cache.last;
  if (last?.size === out.size) {
    const a = [...last];
    const b = [...out];
    const same = a.every(([k, v], i) => {
      const entry = b[i];
      return entry !== undefined && entry[0] === k && entry[1] === v;
    });
    if (same) {
      return last;
    }
  }
  cache.last = out;
  return out;
};

const filterByState = (
  all: Map<string, Position>,
  stateFilter?: PositionState_PositionStateEnum[],
): Map<string, Position> => {
  if (!stateFilter?.length) {
    return all;
  }
  const wanted = new Set(stateFilter);
  const out = new Map<string, Position>();
  for (const [id, position] of all) {
    const state = position.state?.state;
    if (state !== undefined && wanted.has(state)) {
      out.set(id, position);
    }
  }
  return out;
};

/**
 * Owned positions (optionally filtered by state), keyed by bech32 id. One
 * shared query per subaccount; the state filter is applied on top, so
 * switching tabs never refetches.
 *
 * Must be used within the `observer` mobX HOC
 */
export const usePositions = (subaccount = 0, stateFilter?: PositionState_PositionStateEnum[]) => {
  const query = useQuery<Map<string, Position>>({
    queryKey: ['positions', 'all', subaccount],
    queryFn: () => refreshPositions(subaccount),
    enabled: connectionStore.connected,
    // Kept for the session: leaving the page and coming back reads the cache
    // and refreshes only what can have changed.
    gcTime: Infinity,
  });

  // Third-party fills and auto-close change open positions without our own
  // action, so refresh on each block; withdrawn ones are skipped inside.
  useRefetchOnNewBlock(['positions', 'all', subaccount], query, !connectionStore.connected);

  const filterKey = stateFilter?.join(',') ?? '';
  const data = useMemo(
    () => (query.data ? filterByState(query.data, stateFilter) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized filter; callers pass a fresh array literal each render
    [query.data, filterKey],
  );

  return { ...query, data };
};

export const updatePositionsQuery = async () => {
  // Invalidate, not refetch. `refetchQueries` forcibly re-runs every query
  // whose key starts with 'positions' — including inactive portfolio
  // summaries the user cannot see — which fires view-service RPCs the
  // page doesn't need. `invalidateQueries` marks them stale and the
  // active ones refetch themselves; the inactive ones refetch next mount.
  await queryClient.invalidateQueries({ queryKey: ['positions'] });
};

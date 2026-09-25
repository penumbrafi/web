import { DexService, ViewService } from '@penumbra-zone/protobuf';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useQuery } from '@tanstack/react-query';
import {
  Position,
  PositionId,
  PositionState,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { queryClient } from '@/shared/const/queryClient';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block';

// Positions per liquidityPositionsById call, and how many calls run at once.
// Parallel chunks instead of one page after another: a refresh used to walk
// every loaded page in sequence through the wallet, once per block.
const CHUNK = 50;
const PARALLEL = 4;

const fetchOwnedIds = async (
  subaccount: number,
  stateFilter?: PositionState_PositionStateEnum[],
): Promise<PositionId[]> => {
  const states = stateFilter?.map(state => new PositionState({ state })) ?? [undefined];
  const res = await Promise.all(
    states.map(state =>
      Array.fromAsync(
        penumbra.service(ViewService).ownedPositionIds({
          subaccount: new AddressIndex({ account: subaccount }),
          positionState: state,
        }),
      ),
    ),
  );
  return res
    .flat()
    .map(item => item.positionId)
    .filter(Boolean) as PositionId[];
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

// 1) Ask the wallet for owned position ids (one stream read).
// 2) Fetch those positions from the node in parallel chunks.
// Context on two-step fetching process: https://github.com/penumbra-zone/penumbra/pull/4837
const fetchPositions = async (
  subaccount: number,
  stateFilter?: PositionState_PositionStateEnum[],
): Promise<Map<string, Position>> => {
  const ids = await fetchOwnedIds(subaccount, stateFilter);
  const chunks: PositionId[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(ids.slice(i, i + CHUNK));
  }
  const results: [string, Position][][] = new Array<[string, Position][]>(chunks.length);
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
  // Map keeps the owned-id order, so row order is stable across refreshes.
  return new Map(results.flat());
};

/**
 * Every owned position (optionally filtered by state), keyed by bech32 id,
 * in one query. Consumers filter by pair and paginate on the client; paging
 * on the wallet side made /trade stall whenever the first page held no
 * position for the route pair.
 *
 * Must be used within the `observer` mobX HOC
 */
export const usePositions = (subaccount = 0, stateFilter?: PositionState_PositionStateEnum[]) => {
  const query = useQuery<Map<string, Position>>({
    queryKey: ['positions', subaccount, stateFilter],
    queryFn: () => fetchPositions(subaccount, stateFilter),
    enabled: connectionStore.connected,
  });

  // Third-party fills and auto-close (closeOnFill) change our positions
  // without our own action, so refresh on each block. Not also on the
  // pindexer dex_ex tick: nothing here reads pindexer, and the second
  // trigger only doubled the work.
  useRefetchOnNewBlock(['positions', subaccount, stateFilter], query, !connectionStore.connected);

  return query;
};

export const updatePositionsQuery = async () => {
  // Invalidate, not refetch. `refetchQueries` forcibly re-runs every query
  // whose key starts with 'positions' — including inactive portfolio
  // summaries the user cannot see — which fires view-service RPCs the
  // page doesn't need. `invalidateQueries` marks them stale and the
  // active ones refetch themselves; the inactive ones refetch next mount.
  await queryClient.invalidateQueries({ queryKey: ['positions'] });
};

import { DexService, ViewService } from '@penumbra-zone/protobuf';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Position,
  PositionId,
  PositionState,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { queryClient } from '@/shared/const/queryClient';
import { limitAsync } from '@/shared/utils/limit-async';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block';
import { useOnPindexerTick } from '@/shared/api/pindexer-stream';

const BASE_LIMIT = 20;
const BASE_PAGE = 0;

// 1) Query prax to get position ids
// 2) Take those position ids and get position info from the node
// Context on two-step fetching process: https://github.com/penumbra-zone/penumbra/pull/4837
const fetchQuery = async (
  subaccount = 0,
  page = BASE_PAGE,
  stateFilter?: PositionState_PositionStateEnum[],
): Promise<Map<string, Position>> => {
  const states = stateFilter?.map(state => new PositionState({ state })) ?? [undefined];

  const res = await Promise.all(
    states.map(state =>
      Array.fromAsync(
        limitAsync(
          penumbra.service(ViewService).ownedPositionIds({
            subaccount: new AddressIndex({ account: subaccount }),
            positionState: state,
          }),
          BASE_LIMIT,
          BASE_LIMIT * page,
        ),
      ),
    ),
  );

  const positionIds = res
    .flat()
    .map(item => item.positionId)
    .filter(Boolean) as PositionId[];

  const positionsRes = await Array.fromAsync(
    penumbra.service(DexService).liquidityPositionsById({ positionId: positionIds }),
  );

  if (positionsRes.length !== positionIds.length) {
    throw new Error('owned id array does not match the length of the positions response');
  }

  const positions = positionsRes.map(r => r.data).filter(Boolean) as Position[];

  const positionsById = new Map<string, Position>();
  positions.forEach((position, index) => {
    // The responses are in the same order as the requests. Hence, the index matching.
    const positionId = positionIds[index];
    if (positionId) {
      positionsById.set(bech32mPositionId(positionId), position);
    }
  });

  return positionsById;
};

/**
 * Must be used within the `observer` mobX HOC
 */
export const usePositions = (subaccount = 0, stateFilter?: PositionState_PositionStateEnum[]) => {
  const query = useInfiniteQuery<Map<string, Position>>({
    queryKey: ['positions', subaccount, stateFilter],
    initialPageParam: BASE_PAGE,
    getNextPageParam: (lastPage, _, lastPageParam) => {
      return lastPage.size ? (lastPageParam as number) + 1 : undefined;
    },
    queryFn: ({ pageParam }) => fetchQuery(subaccount, pageParam as number, stateFilter),
    enabled: connectionStore.connected,
  });

  // Third-party fills and auto-close (closeOnFill) mutate our positions
  // without our own action. Without a block-tick refresh My Positions,
  // the chart's position lines, and the drag overlay stay on the state
  // that existed when the user last acted. Refresh on each new block AND
  // on pindexer dex_ex commit so the view catches both the on-chain state
  // (via view service) and dex_ex-observable close/fill events.
  useRefetchOnNewBlock(
    ['positions', subaccount, stateFilter],
    query,
    !connectionStore.connected,
  );
  useOnPindexerTick(['dex_ex'], ['positions', subaccount, stateFilter]);

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

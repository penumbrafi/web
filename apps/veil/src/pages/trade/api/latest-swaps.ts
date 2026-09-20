import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { LatestSwapsResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { DirectedTradingPair } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import type { MyExecutionsRequestBody } from '@/shared/api/server/my-executions';
import type { RecentExecution } from '@/shared/api/server/recent-executions';
import { connectionStore } from '@/shared/model/connection';
import { penumbra } from '@/shared/const/penumbra';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block';
import { useOnPindexerTick } from '@/shared/api/pindexer-stream';
import { apiPostFetch } from '@/shared/utils/api-fetch';
import { usePathToMetadata } from '../model/use-path';
import { pnum } from '@penumbra-zone/types/pnum';

const fetchQuery = async (
  subaccount = 0,
  base?: AssetId,
  quote?: AssetId,
): Promise<LatestSwapsResponse[]> => {
  if (!base || !quote) {
    return [];
  }

  // Two requests to get swaps in both directions: buy and sell
  const accountFilter =
    typeof subaccount === 'undefined' ? undefined : new AddressIndex({ account: subaccount });
  const swaps = await Promise.all([
    Array.fromAsync(
      penumbra.service(ViewService).latestSwaps({
        pair: new DirectedTradingPair({ start: base, end: quote }),
        accountFilter,
      }),
    ),
    Array.fromAsync(
      penumbra.service(ViewService).latestSwaps({
        pair: new DirectedTradingPair({ start: quote, end: base }),
        accountFilter,
      }),
    ),
  ]);

  return swaps.flat();
};

const MY_TRADES_KEY = 'my-trades';
const MY_EXECUTIONS_KEY = 'my-executions';

/**
 * Must be used within the `observer` mobX HOC
 */
export const useLatestSwaps = (subaccount?: number) => {
  const { baseAsset, quoteAsset, baseSymbol, quoteSymbol } = usePathToMetadata();

  const myTradesQuery = useQuery({
    queryKey: [MY_TRADES_KEY, subaccount, baseSymbol, quoteSymbol],
    staleTime: Infinity,
    queryFn: () => fetchQuery(subaccount, baseAsset?.penumbraAssetId, quoteAsset?.penumbraAssetId),
    enabled: connectionStore.connected && !!baseSymbol && !!quoteSymbol,
  });

  // Pindexer query – will not run if `myTradesQuery` data didn't change.
  // Cache key MUST include subaccount + pair, else switching pairs (or
  // accounts) with equal swap counts serves the previous pair's data
  // forever — length alone collides across pairs.
  const myExecutionsKey = [
    MY_EXECUTIONS_KEY,
    subaccount,
    baseSymbol,
    quoteSymbol,
    myTradesQuery.data?.length ?? 0,
  ];
  const myExecutionsQuery = useQuery({
    queryKey: myExecutionsKey,
    enabled: typeof myTradesQuery.data !== 'undefined',
    staleTime: Infinity,
    queryFn: async () => {
      if (!myTradesQuery.data?.length) {
        return [];
      }

      const mapped = myTradesQuery.data
        .map(swap => {
          return (
            swap.pair &&
            swap.input &&
            swap.output && {
              height: Number(swap.blockHeight),
              input: Number(pnum(swap.input.amount).toNumber()),
              output: Number(pnum(swap.output.amount).toNumber()),
              base: swap.pair.start?.toJson(),
              quote: swap.pair.end?.toJson(),
            }
          );
        })
        .filter(Boolean) as MyExecutionsRequestBody[];

      return apiPostFetch<RecentExecution[]>('/api/my-executions', mapped);
    },
  });

  // A new swap appears in Prax's `latestSwaps` (myTradesQuery) first and
  // lands in pindexer a few seconds later. Refetch the pindexer side the
  // moment dex_ex commits rather than polling — the previous
  // `refetchInterval` looked up a 2-element key that never existed, so it
  // polled every 5s forever.
  useOnPindexerTick(['dex_ex'], myExecutionsKey);

  // Pass a per-instance key + `disabled` so a page-2 mount (or a second
  // subaccount) doesn't race the first over the module-global
  // `lastRefetchedBlockHeights` map, and so `refetch()` doesn't fire the
  // view-service call while disconnected — React Query's `enabled: false`
  // does not gate an imperative refetch.
  useRefetchOnNewBlock(
    [MY_TRADES_KEY, subaccount, baseSymbol, quoteSymbol],
    myTradesQuery,
    !connectionStore.connected || !baseSymbol || !quoteSymbol,
  );

  return {
    ...myExecutionsQuery,
    isLoading: myTradesQuery.isLoading || myExecutionsQuery.isLoading,
  };
};

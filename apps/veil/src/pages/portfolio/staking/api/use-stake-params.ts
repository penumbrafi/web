import { useQuery } from '@tanstack/react-query';
import { AppService } from '@penumbra-zone/protobuf';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * Chain staking parameters, for telling the user when their action takes
 * effect. Connected-only, like every other provider-backed query here.
 */
export const useStakeParams = () => {
  const connected = connectionStore.connected;

  return useQuery<{ unbondingDelay: bigint } | undefined>({
    queryKey: ['app-service-stake-params'],
    enabled: connected,
    // Chain parameters change only at upgrades.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { appParameters } = await penumbra.service(AppService).appParameters({});
      const unbondingDelay = appParameters?.stakeParams?.unbondingDelay;
      return unbondingDelay === undefined ? undefined : { unbondingDelay };
    },
  });
};

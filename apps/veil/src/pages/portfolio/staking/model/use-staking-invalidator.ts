import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { stakingStore } from './staking-store';

/**
 * Wire the staking store's post-transaction refresh to react-query.
 *
 * Must be called by every component that can open a staking dialog. It was
 * previously done inline in the staking page only, so a delegate initiated
 * anywhere else left balances, delegations and unbonding tokens stale until
 * the next manual reload.
 */
export const useStakingInvalidator = (): void => {
  const queryClient = useQueryClient();
  useEffect(() => {
    stakingStore.setInvalidator(() => {
      void queryClient.invalidateQueries({ queryKey: ['view-service-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-unbonding-tokens'] });
    });
  }, [queryClient]);
};

import { useMemo } from 'react';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { BalancesResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { getDisplayDenomFromView } from '@penumbra-zone/getters/value-view';
import { getAddressIndex } from '@penumbra-zone/getters/balances-response';
import { useBalances } from '@/shared/api/balances';
import { connectionStore } from '@/shared/model/connection';
import { useStakingTokenMetadata } from '@/shared/api/registry';

/**
 * Returns the BalancesResponse and ValueView for the connected subaccount's
 * staking-token (UM) balance. Used to populate "available to delegate".
 */
export const useStakingTokenBalance = (): {
  balance?: BalancesResponse;
  valueView?: ValueView;
  isLoading: boolean;
} => {
  const subaccount = connectionStore.subaccount;
  const { data: balances, isLoading } = useBalances(subaccount);
  const { data: stakingTokenMetadata } = useStakingTokenMetadata();

  const balance = useMemo<BalancesResponse | undefined>(() => {
    if (!balances) {
      return undefined;
    }
    return balances.find(b => {
      if (!b.balanceView) {
        return false;
      }
      const accountIndex = getAddressIndex.optional(b);
      if (accountIndex && accountIndex.account !== subaccount) {
        return false;
      }
      return getDisplayDenomFromView(b.balanceView) === stakingTokenMetadata.display;
    });
  }, [balances, stakingTokenMetadata, subaccount]);

  return {
    balance,
    valueView: balance?.balanceView,
    isLoading,
  };
};

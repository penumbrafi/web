'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useQueryClient } from '@tanstack/react-query';
import { getValidator, getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { isDelegationTokenForValidator } from '@penumbra-zone/types/staking';
import { connectionStore } from '@/shared/model/connection';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { useValidatorInfos } from '../api/use-validator-infos';
import { useDelegations } from '../api/use-delegations';
import { useStakingTokenBalance } from '../api/use-staking-token-balance';
import { stakingStore } from '../model/staking-store';
import { useResolvePendingAction } from '../model/use-resolve-pending-action';
import { StakingFormDialog } from './form-dialog';

/**
 * Mounts the staking dialog anywhere in the app — /portfolio, /explore, wherever
 * we want an inline delegate/undelegate flow instead of routing to a
 * separate page.
 *
 * Loads the data the form needs (validator infos, delegations, UM balance
 * + metadata), runs the pending-action resolver, and renders the dialog
 * for whichever validator is currently active in `stakingStore`.
 *
 * The dialog is a MobX singleton on `stakingStore`, so mount at most once
 * per page. It's a no-op UI when nothing is active.
 */
export const StakingDialogHost = observer(() => {
  const queryClient = useQueryClient();
  const { connected, subaccount } = connectionStore;
  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [] } = useDelegations(balances);
  const { data: validatorInfosResult } = useValidatorInfos();

  // Wire submissions to refresh the same react-query caches the staking page
  // uses. Idempotent — last mount wins, which is fine since all callers set
  // the same invalidator.
  useEffect(() => {
    stakingStore.setInvalidator(() => {
      void queryClient.invalidateQueries({ queryKey: ['view-service-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-unbonding-tokens'] });
    });
  }, [queryClient]);

  useResolvePendingAction({ connected, validatorInfosResult });

  const active = stakingStore.validatorInfo;
  if (!active) {
    return null;
  }

  const validator = getValidator(active);
  const identityKey = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(active));
  const votingPowerPercentage = validatorInfosResult?.votingPowerByIdentityKey?.[identityKey] ?? 0;
  const delegationTokens = delegations.find(d => isDelegationTokenForValidator(d, active));

  return (
    <StakingFormDialog
      validator={validator}
      votingPowerPercentage={votingPowerPercentage}
      stakingTokens={stakingTokens}
      delegationTokens={delegationTokens}
      stakingTokenMetadata={stakingTokenMetadata}
      allDelegations={delegations}
    />
  );
});

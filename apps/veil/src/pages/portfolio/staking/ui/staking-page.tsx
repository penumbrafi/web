'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { observer } from 'mobx-react-lite';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@penumbra-zone/ui/Text';
import { connectionStore } from '@/shared/model/connection';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { ConnectButton } from '@/features/connect/connect-button';
import { useValidatorInfos } from '../api/use-validator-infos';
import { useDelegations } from '../api/use-delegations';
import { useUnbondingTokens } from '../api/use-unbonding-tokens';
import { useStakingTokenBalance } from '../api/use-staking-token-balance';
import { stakingStore } from '../model/staking-store';
import { StakingHeader } from './header';
import { DelegationsList } from './delegations-list';
import { ValidatorsTable } from './validators-table';
import { getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';

export const StakingPage = observer(() => {
  const queryClient = useQueryClient();
  const { connected, connectedLoading, subaccount } = connectionStore;
  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [], isLoading: delegationsLoading } = useDelegations(balances);
  const { data: unbondingTokens } = useUnbondingTokens();
  const {
    data: validatorInfosResult,
    isLoading: validatorsLoading,
    error: validatorsError,
  } = useValidatorInfos();

  // Wire the store's invalidator to react-query so submissions refresh data.
  useEffect(() => {
    stakingStore.setInvalidator(() => {
      void queryClient.invalidateQueries({ queryKey: ['view-service-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-unbonding-tokens'] });
    });
  }, [queryClient]);

  // Deep-link from /explore/validators/[identityKey]:
  // ?delegate=<bech32 identity> or ?undelegate=<bech32 identity> pre-opens
  // the matching dialog for that validator once both wallet and
  // validator-list are ready. We only auto-open once per page mount;
  // after that the user is in normal control of the dialog.
  const searchParams = useSearchParams();
  const delegateTarget = searchParams?.get('delegate') ?? null;
  const undelegateTarget = searchParams?.get('undelegate') ?? null;
  const target = delegateTarget ?? undelegateTarget;
  const action: 'delegate' | 'undelegate' = undelegateTarget ? 'undelegate' : 'delegate';
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!connected || !target) return;
    const validatorInfos = validatorInfosResult?.validatorInfos;
    if (!validatorInfos?.length) return;
    const match = validatorInfos.find(vi => {
      const ik = getIdentityKeyFromValidatorInfo.optional(vi);
      if (!ik) return false;
      try {
        return bech32mIdentityKey(ik) === target;
      } catch {
        return false;
      }
    });
    if (match) {
      stakingStore.openDialog(action, match);
      autoOpenedRef.current = true;
    }
  }, [connected, target, action, validatorInfosResult]);

  if (connectedLoading) {
    return (
      <div className='container mx-auto max-w-[1136px] py-12'>
        <Text color='text.secondary'>Loading wallet…</Text>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className='container mx-auto flex max-w-[1136px] flex-col items-center gap-4 py-16'>
        <Text large>Connect your wallet to stake</Text>
        <Text color='text.secondary'>
          Delegate your shielded UM to a validator and start earning rewards.
        </Text>
        <ConnectButton />
      </div>
    );
  }

  const validatorInfos = validatorInfosResult?.validatorInfos ?? [];
  const votingPowerByIdentityKey = validatorInfosResult?.votingPowerByIdentityKey ?? {};

  return (
    <div className='container mx-auto flex max-w-[1136px] flex-col gap-6 py-8'>
      <div className='flex flex-col gap-1'>
        <Text xxl as='h1'>
          Staking
        </Text>
        <Text small color='text.secondary'>
          Delegate UM to a validator to secure the chain and earn rewards. Subaccount{' '}
          #{subaccount}.
        </Text>
      </div>

      <StakingHeader stakingTokens={stakingTokens} unbondingTokens={unbondingTokens} />

      <section className='flex flex-col gap-3'>
        <Text large as='h2'>
          Your delegations
        </Text>
        {delegationsLoading ? (
          <Text color='text.secondary'>Loading delegations…</Text>
        ) : (
          <DelegationsList
            delegations={delegations}
            votingPowerByIdentityKey={votingPowerByIdentityKey}
            stakingTokens={stakingTokens}
            stakingTokenMetadata={stakingTokenMetadata}
          />
        )}
      </section>

      <section className='flex flex-col gap-3'>
        <div className='flex items-center justify-between'>
          <Text large as='h2'>
            Browse validators
          </Text>
          <Text small color='text.secondary'>
            {validatorInfos.length > 0 && `${validatorInfos.length} active`}
          </Text>
        </div>

        {validatorsError ? (
          <Text color='destructive.light'>
            Failed to load validators: {String(validatorsError)}
          </Text>
        ) : (
          <ValidatorsTable
            validatorInfos={validatorInfos}
            votingPowerByIdentityKey={votingPowerByIdentityKey}
            delegations={delegations}
            stakingTokens={stakingTokens}
            stakingTokenMetadata={stakingTokenMetadata}
            loading={validatorsLoading}
          />
        )}
      </section>
    </div>
  );
});

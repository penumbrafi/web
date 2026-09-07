'use client';

import { FC } from 'react';
import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { getValidator } from '@penumbra-zone/getters/validator-info';
import { Surface } from '@/pages/inspect/explorer/components';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { useValidatorInfos } from '@/pages/portfolio/staking/api/use-validator-infos';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { useStakingTokenBalance } from '@/pages/portfolio/staking/api/use-staking-token-balance';
import { useStakingInvalidator } from '@/pages/portfolio/staking/model/use-staking-invalidator';
import { StakingActions } from '@/pages/portfolio/staking/ui/staking-actions';
import { StakingFormDialog } from '@/pages/portfolio/staking/ui/form-dialog';
import {
  findDelegationToken,
  findValidatorInfo,
  stakeGate,
} from '@/pages/inspect/explorer/lib/staking/match-validator';

interface Props {
  className?: string;
  /** Bech32m identity key of the validator being viewed. */
  validatorId: string;
}

const Shell: FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <Surface as='section' className={classNames('flex flex-col gap-4 p-6', className)}>
    <header className='flex flex-col gap-1'>
      <h2 className='text-2xl font-medium'>Stake</h2>
      <p className='text-sm text-text-secondary'>
        Delegate to back this validator&apos;s voting power, or undelegate to start the unbonding
        period.
      </p>
    </header>
    {children}
  </Surface>
);

/**
 * Delegate / undelegate for the validator being viewed.
 *
 * Was a permanently-disabled stub with a "Wallet integration pending"
 * tooltip; this wires it to the real staking flow. The surrounding page is
 * server-rendered from our own indexer, so this component is wallet-gated in
 * isolation and degrades to a connect prompt rather than an error.
 */
export const ValidatorStakeActions = observer(({ className, validatorId }: Props) => {
  const { connected, connectedLoading, subaccount } = connectionStore;
  useStakingInvalidator();

  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [] } = useDelegations(balances);
  const { data: validatorInfosResult } = useValidatorInfos();

  const validatorInfo = findValidatorInfo(validatorInfosResult?.validatorInfos, validatorId);
  const delegationTokens = findDelegationToken(delegations, validatorId);

  const gate = stakeGate({
    connected,
    connectedLoading,
    hasValidatorInfo: !!validatorInfo,
    hasDelegation: !!delegationTokens,
  });

  if (gate.kind === 'checking') {
    return (
      <Shell className={className}>
        <Text small color='text.secondary'>
          Checking for a wallet…
        </Text>
      </Shell>
    );
  }

  if (gate.kind === 'connect') {
    return (
      <Shell className={className}>
        <div className='flex flex-col items-start gap-3'>
          <Text small color='text.secondary'>
            Connect a wallet to delegate UM to this validator.
          </Text>
          <ConnectButton actionType='default' />
        </div>
      </Shell>
    );
  }

  if (gate.kind === 'loading' || !validatorInfo) {
    return (
      <Shell className={className}>
        <Text small color='text.secondary'>
          Loading this validator&apos;s staking rate…
        </Text>
      </Shell>
    );
  }

  const votingPowerPercentage = validatorInfosResult?.votingPowerByIdentityKey[validatorId] ?? 0;

  return (
    <Shell className={className}>
      <StakingActions
        validatorInfo={validatorInfo}
        stakingTokens={stakingTokens}
        delegationTokens={delegationTokens}
        delegateOnly={!gate.canUndelegate}
      />
      <StakingFormDialog
        validator={getValidator(validatorInfo)}
        votingPowerPercentage={votingPowerPercentage}
        stakingTokens={stakingTokens}
        delegationTokens={delegationTokens}
        stakingTokenMetadata={stakingTokenMetadata}
        allDelegations={delegations}
      />
    </Shell>
  );
});

ValidatorStakeActions.displayName = 'ValidatorStakeActions';

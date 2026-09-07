'use client';

import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { useValidatorInfos } from '@/pages/portfolio/staking/api/use-validator-infos';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { useUnbondingTokens } from '@/pages/portfolio/staking/api/use-unbonding-tokens';
import { useStakingTokenBalance } from '@/pages/portfolio/staking/api/use-staking-token-balance';
import { useStakingInvalidator } from '@/pages/portfolio/staking/model/use-staking-invalidator';
import { usePendingDelegate } from '@/pages/inspect/explorer/lib/staking/use-pending-delegate';
import { totalDelegatedUm } from '@/pages/inspect/explorer/lib/staking/match-validator';
import { StakingHeader } from '@/pages/portfolio/staking/ui/header';
import { DelegationsList } from '@/pages/portfolio/staking/ui/delegations-list';
import { Surface } from '@/pages/inspect/explorer/components';
import { classNames } from '@/pages/inspect/explorer/lib/utils';

interface Props {
  className?: string;
}

/**
 * The wallet-gated half of the validators view: your stake, your delegations,
 * and the delegate / undelegate actions on them.
 *
 * Everything *around* this panel — the validator table, voting power, uptime,
 * commission — is server-rendered from our own indexer and needs no wallet at
 * all. That separation is the point. This component is the only part of the
 * page that talks to the provider, it renders a connect prompt rather than an
 * error when there is no wallet, and it never blocks the rest of the page from
 * painting.
 */
export const StakingPanel = observer(({ className }: Props) => {
  const { connected, connectedLoading, subaccount } = connectionStore;
  useStakingInvalidator();

  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [], isLoading: delegationsLoading } = useDelegations(balances);
  const { data: unbondingTokens } = useUnbondingTokens();
  const { data: validatorInfosResult } = useValidatorInfos();

  // Delegation tokens are not UM and are not comparable across validators —
  // each carries its own exchange rate. Converted per validator, not summed raw.
  const totalDelegated = totalDelegatedUm(delegations);

  // Resolves both ?delegate=<id> and a row Delegate click made before
  // connecting, opening the dialog on the validator the user chose.
  usePendingDelegate(validatorInfosResult?.validatorInfos);

  // While the provider handshake is in flight, say so rather than flashing a
  // connect prompt at a user who is already connected.
  if (connectedLoading) {
    return (
      <Surface as='section' className={classNames('flex flex-col gap-1 p-6', className)}>
        <Text large as='h2'>
          Your stake
        </Text>
        <Text small color='text.secondary'>
          Checking for a wallet…
        </Text>
      </Surface>
    );
  }

  if (!connected) {
    return (
      <Surface
        as='section'
        className={classNames(
          'flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between',
          className,
        )}
      >
        <div className='flex flex-col gap-1'>
          <Text large as='h2'>
            Your stake
          </Text>
          <Text small color='text.secondary'>
            Connect a wallet to delegate UM to any validator below and earn staking rewards.
            Validator data on this page is public and needs no wallet.
          </Text>
        </div>
        <ConnectButton actionType='default' />
      </Surface>
    );
  }

  return (
    <Surface as='section' className={classNames('flex flex-col gap-4 p-6', className)}>
      <div className='flex flex-col gap-1'>
        <Text large as='h2'>
          Your stake
        </Text>
        <Text small color='text.secondary'>
          Subaccount #{subaccount}.
        </Text>
      </div>

      <StakingHeader
        stakingTokens={stakingTokens}
        unbondingTokens={unbondingTokens}
        totalDelegated={delegationsLoading ? undefined : totalDelegated}
      />

      <div className='flex flex-col gap-2'>
        <Text as='h3' color='text.secondary'>
          Your delegations
        </Text>
        {delegationsLoading ? (
          <Text color='text.secondary'>Loading delegations…</Text>
        ) : (
          <DelegationsList
            delegations={delegations}
            votingPowerByIdentityKey={validatorInfosResult?.votingPowerByIdentityKey ?? {}}
            stakingTokens={stakingTokens}
            stakingTokenMetadata={stakingTokenMetadata}
          />
        )}
      </div>
    </Surface>
  );
});

StakingPanel.displayName = 'StakingPanel';

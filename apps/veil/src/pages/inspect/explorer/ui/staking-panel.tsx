'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { observer } from 'mobx-react-lite';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@penumbra-zone/ui/Text';
import { getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { useValidatorInfos } from '@/pages/portfolio/staking/api/use-validator-infos';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { useUnbondingTokens } from '@/pages/portfolio/staking/api/use-unbonding-tokens';
import { useStakingTokenBalance } from '@/pages/portfolio/staking/api/use-staking-token-balance';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';
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
  const queryClient = useQueryClient();
  const { connected, connectedLoading, subaccount } = connectionStore;

  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [], isLoading: delegationsLoading } = useDelegations(balances);
  const { data: unbondingTokens } = useUnbondingTokens();
  const { data: validatorInfosResult } = useValidatorInfos();

  // Refresh the read side after a delegate / undelegate lands.
  useEffect(() => {
    stakingStore.setInvalidator(() => {
      void queryClient.invalidateQueries({ queryKey: ['view-service-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['view-service-unbonding-tokens'] });
    });
  }, [queryClient]);

  // Deep link from a validator detail page: ?delegate=<bech32 identity> opens
  // the delegate dialog for that validator once the wallet and the validator
  // infos are both ready. Preserved from the standalone staking page this
  // panel replaces, so existing links keep working.
  const searchParams = useSearchParams();
  const delegateTarget = searchParams?.get('delegate') ?? null;
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !connected || !delegateTarget) {
      return;
    }
    const validatorInfos = validatorInfosResult?.validatorInfos;
    if (!validatorInfos?.length) {
      return;
    }
    const match = validatorInfos.find(vi => {
      const ik = getIdentityKeyFromValidatorInfo.optional(vi);
      if (!ik) {
        return false;
      }
      try {
        return bech32mIdentityKey(ik) === delegateTarget;
      } catch {
        return false;
      }
    });
    if (match) {
      stakingStore.openDialog('delegate', match);
      autoOpenedRef.current = true;
    }
  }, [connected, delegateTarget, validatorInfosResult]);

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

      <StakingHeader stakingTokens={stakingTokens} unbondingTokens={unbondingTokens} />

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

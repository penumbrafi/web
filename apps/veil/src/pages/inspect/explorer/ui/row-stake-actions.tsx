'use client';

import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { PenumbraClient } from '@penumbra-zone/client';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { getValidator } from '@penumbra-zone/getters/validator-info';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { useBalances } from '@/shared/api/balances';
import { useValidatorInfos } from '@/pages/portfolio/staking/api/use-validator-infos';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { useUnbondingTokens } from '@/pages/portfolio/staking/api/use-unbonding-tokens';
import { useStakingTokenBalance } from '@/pages/portfolio/staking/api/use-staking-token-balance';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';
import { useStakingInvalidator } from '@/pages/portfolio/staking/model/use-staking-invalidator';
import { StakingFormDialog } from '@/pages/portfolio/staking/ui/form-dialog';
import {
  claimableForValidator,
  findDelegationToken,
  findValidatorInfo,
} from '@/pages/inspect/explorer/lib/staking/match-validator';

/**
 * `TableRow` navigates to the validator detail page on any click whose target
 * is not an anchor, so every actions cell has to stop propagation or Delegate
 * would both open the dialog and navigate away from it.
 */
const stopRowNavigation = (e: React.MouseEvent) => e.stopPropagation();

interface Props {
  /** Bech32m identity key — the GraphQL row's `id`. */
  validatorId: string;
  /** Whether this validator is currently in the active set. */
  active: boolean;
}

/**
 * Delegate / Undelegate / Claim for a single row of the validator table,
 * plus what the user currently holds with that validator.
 *
 * A client leaf inside a server-rendered table. The props are the two
 * serializable fields it needs; everything wallet-shaped is read from
 * react-query here, which dedupes the shared queries across every row down to
 * one fetch each.
 *
 * Delegating with no wallet connected must not be a dead end: the button
 * becomes a connect prompt that remembers which validator was clicked, and the
 * dialog opens on this row once the connection lands. See
 * `usePendingDelegate`.
 */
export const RowStakeActions = observer(({ validatorId, active }: Props) => {
  const { connected, connectedLoading, subaccount } = connectionStore;
  useStakingInvalidator();

  // `getProviders()` reads `window`, so it can only run after mount — doing it
  // during render would desync server and client HTML.
  const [hasProvider, setHasProvider] = useState(false);
  useEffect(() => {
    setHasProvider(Object.keys(PenumbraClient.getProviders()).length > 0);
  }, []);

  const { data: stakingTokenMetadata } = useStakingTokenMetadata();
  const { data: balances } = useBalances(subaccount);
  const { valueView: stakingTokens } = useStakingTokenBalance();
  const { data: delegations = [] } = useDelegations(balances);
  const { data: unbondingTokens } = useUnbondingTokens();
  const { data: validatorInfosResult } = useValidatorInfos();

  const delegationTokens = findDelegationToken(delegations, validatorId);
  const claimable = claimableForValidator(unbondingTokens?.claimable.tokens, validatorId);
  const validatorInfo = findValidatorInfo(validatorInfosResult?.validatorInfos, validatorId);
  const isPending = stakingStore.pendingValidatorId === validatorId;

  const holdings = delegationTokens ? (
    <ValueViewComponent valueView={delegationTokens} priority='primary' />
  ) : (
    <Text detail color='text.secondary'>
      —
    </Text>
  );

  // Not connected: offer to connect, remembering the intent. Wrapping
  // ConnectButton rather than modifying it keeps this change off a file with
  // unrelated work in flight.
  //
  // With no wallet extension installed at all, ConnectButton renders "Get
  // Wallet" — correct, but repeating it down 50 rows is noise for someone who
  // simply came to read validator data. The panel at the top of the page
  // already makes that offer once, so rows stay quiet.
  if (!connected) {
    return (
      <div
        id={`validator-${validatorId}`}
        onClick={stopRowNavigation}
        className='flex items-center justify-end gap-2'
      >
        {connectedLoading ? (
          <Text detail color='text.secondary'>
            Checking wallet…
          </Text>
        ) : hasProvider ? (
          <span onClickCapture={() => stakingStore.setPendingDelegate(validatorId)}>
            <ConnectButton actionType='default' variant='minimal'>
              Delegate
            </ConnectButton>
          </span>
        ) : (
          <Text detail color='text.secondary'>
            —
          </Text>
        )}
      </div>
    );
  }

  // `useValidatorInfos` requests the active set only, so an inactive
  // validator will never resolve one. Say that instead of spinning forever.
  if (!active) {
    return (
      <div
        id={`validator-${validatorId}`}
        onClick={stopRowNavigation}
        className='flex items-center justify-end gap-2'
      >
        {holdings}
        <Text detail color='text.secondary'>
          Inactive
        </Text>
      </div>
    );
  }

  if (!validatorInfo) {
    return (
      <div
        id={`validator-${validatorId}`}
        onClick={stopRowNavigation}
        className='flex items-center justify-end gap-2'
      >
        {holdings}
        <Text detail color='text.secondary'>
          Loading…
        </Text>
      </div>
    );
  }

  const votingPowerPercentage = validatorInfosResult?.votingPowerByIdentityKey[validatorId] ?? 0;

  return (
    <div
      id={`validator-${validatorId}`}
      onClick={stopRowNavigation}
      className='flex items-center justify-end gap-2'
    >
      {holdings}
      <Button
        actionType='accent'
        priority='primary'
        density='compact'
        disabled={isPending || stakingStore.submitting}
        onClick={() => stakingStore.openDialog('delegate', validatorInfo)}
      >
        {isPending ? 'Pending…' : 'Delegate'}
      </Button>
      {delegationTokens && (
        <Button
          actionType='default'
          priority='secondary'
          density='compact'
          disabled={isPending || stakingStore.submitting}
          onClick={() => stakingStore.openDialog('undelegate', validatorInfo)}
        >
          Undelegate
        </Button>
      )}
      {claimable.length > 0 && (
        <Button
          actionType='default'
          priority='secondary'
          density='compact'
          disabled={stakingStore.submitting}
          onClick={() => void stakingStore.claimUnbonded(claimable)}
        >
          Claim
        </Button>
      )}
      <StakingFormDialog
        validator={getValidator(validatorInfo)}
        votingPowerPercentage={votingPowerPercentage}
        stakingTokens={stakingTokens}
        delegationTokens={delegationTokens}
        stakingTokenMetadata={stakingTokenMetadata}
        allDelegations={delegations}
      />
    </div>
  );
});

RowStakeActions.displayName = 'RowStakeActions';

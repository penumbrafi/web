'use client';

import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { stakingStore } from '../model/staking-store';
import { UnbondingTokensForAccount } from '../api/use-unbonding-tokens';

export interface StakingHeaderProps {
  stakingTokens?: ValueView;
  unbondingTokens?: UnbondingTokensForAccount;
  /**
   * Total currently delegated, in display UM, already converted through each
   * validator's own exchange rate. Undefined while delegations are loading.
   */
  totalDelegated?: { um: number; unconverted: number };
}

const Stat = ({
  label,
  helpText,
  children,
}: {
  label: string;
  helpText?: string;
  children: React.ReactNode;
}) => (
  <div className='flex flex-1 flex-col gap-1'>
    <Text small color='text.secondary'>
      {label}
    </Text>
    <div className='flex flex-col gap-1'>{children}</div>
    {helpText && (
      <Text detail color='text.secondary'>
        {helpText}
      </Text>
    )}
  </div>
);

export const StakingHeader = observer(
  ({ stakingTokens, unbondingTokens, totalDelegated }: StakingHeaderProps) => {
    const claimableTokens = unbondingTokens?.claimable.tokens ?? [];
    const canClaim = claimableTokens.length > 0;

    return (
      <div className='flex flex-col gap-4 rounded-xl bg-other-tonal-fill5 p-6 backdrop-blur-md md:flex-row md:items-start md:gap-8'>
        <Stat label='Available to delegate'>
          {stakingTokens && <ValueViewComponent valueView={stakingTokens} priority='primary' />}
        </Stat>

        <Stat
          label='Delegated'
          helpText={
            totalDelegated?.unconverted
              ? 'At least this much — some delegations could not be valued.'
              : 'Your delegation tokens valued in UM at each validator’s current exchange rate.'
          }
        >
          {totalDelegated && (
            <Text large color='text.primary'>
              {totalDelegated.unconverted ? '≥ ' : ''}
              {totalDelegated.um.toLocaleString(undefined, { maximumFractionDigits: 4 })} UM
            </Text>
          )}
        </Stat>

        <Stat
          label='Unbonding'
          helpText='Once the unbonding period elapses, these tokens become claimable as UM.'
        >
          {unbondingTokens?.notYetClaimable.total && (
            <ValueViewComponent
              valueView={unbondingTokens.notYetClaimable.total}
              priority='secondary'
            />
          )}
        </Stat>

        <Stat
          label='Claimable'
          helpText='Unbonded tokens you can claim now to receive UM back into your wallet.'
        >
          {unbondingTokens?.claimable.total && (
            <ValueViewComponent valueView={unbondingTokens.claimable.total} priority='primary' />
          )}
          {canClaim && (
            <div className='mt-2'>
              <Button
                actionType='accent'
                priority='primary'
                density='compact'
                disabled={stakingStore.submitting}
                onClick={() => void stakingStore.claimUnbonded(claimableTokens)}
              >
                Claim now
              </Button>
            </div>
          )}
        </Stat>
      </div>
    );
  },
);

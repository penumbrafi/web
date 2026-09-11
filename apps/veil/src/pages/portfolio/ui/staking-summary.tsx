'use client';

import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { getAmount } from '@penumbra-zone/getters/value-view';
import { useUnbondingTokens } from '@/pages/portfolio/staking/api/use-unbonding-tokens';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';

/**
 * Compact card that appears in /portfolio when the user has anything in the
 * unbonding pipeline — pending unbondings or tokens ready to claim. Renders
 * nothing otherwise (portfolio stays clean for users with no staking activity).
 *
 * The delegation positions themselves already show as `DelegationRows` inside
 * the assets table, so this card is only about the flows the assets table
 * can't naturally represent: waiting on the unbonding period, and finalizing
 * the claim back to UM.
 */
export const StakingSummary = observer(() => {
  const { data: unbondingTokens } = useUnbondingTokens();

  const notYetClaimable = unbondingTokens?.notYetClaimable.total;
  const claimable = unbondingTokens?.claimable.total;
  const claimableTokens = unbondingTokens?.claimable.tokens ?? [];

  const hasNotYet = !!notYetClaimable && joinLoHiAmount(getAmount(notYetClaimable)) > 0n;
  const hasClaimable = claimableTokens.length > 0;
  if (!hasNotYet && !hasClaimable) {
    return null;
  }

  return (
    <div className='flex flex-col gap-3 rounded-xl bg-other-tonal-fill5 p-4 backdrop-blur-md md:flex-row md:items-center md:justify-between'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:gap-8'>
        {hasNotYet && (
          <Stat label='Unbonding'>
            {notYetClaimable && (
              <ValueViewComponent valueView={notYetClaimable} priority='secondary' />
            )}
          </Stat>
        )}
        {hasClaimable && claimable && (
          <Stat label='Ready to claim'>
            <ValueViewComponent valueView={claimable} priority='primary' />
          </Stat>
        )}
      </div>
      {hasClaimable && (
        <Button
          actionType='accent'
          priority='primary'
          density='compact'
          disabled={stakingStore.submitting}
          onClick={() => void stakingStore.claimUnbonded(claimableTokens)}
        >
          Claim now
        </Button>
      )}
    </div>
  );
});

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className='flex flex-col gap-1'>
    <Text small color='text.secondary'>
      {label}
    </Text>
    {children}
  </div>
);

'use client';

import { useCallback, type FC } from 'react';
import { observer } from 'mobx-react-lite';
import { Coins, MinusCircle } from 'lucide-react';
import { Surface } from '@/pages/inspect/explorer/components';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';

interface Props {
  /** bech32m validator identity key. */
  validatorId: string;
  className?: string;
}

/**
 * Per-validator delegate/undelegate CTAs, inline on /explore/validators/[id].
 *
 * Clicking sets `stakingStore.pending`. Once the wallet is connected and the
 * validator list has loaded, the resolver in `<StakingDialogHost>` opens the
 * matching dialog right on this page — no navigation to /portfolio.
 *
 * When the wallet isn't connected, we still record the pending action and
 * surface a Connect prompt: the click doesn't get lost, and the dialog
 * opens automatically as soon as the wallet is available.
 */
export const ValidatorStakeActions: FC<Props> = observer(({ validatorId, className }) => {
  const { connected } = connectionStore;
  const pending = stakingStore.pending;
  const pendingHere = pending?.identityKey === validatorId ? pending.action : null;

  const request = useCallback(
    (action: 'delegate' | 'undelegate') => {
      stakingStore.setPending({ action, identityKey: validatorId });
    },
    [validatorId],
  );

  return (
    <Surface as='section' className={classNames('flex flex-col gap-4 p-6', className)}>
      <header className='flex flex-col gap-1'>
        <h2 className='text-2xl font-medium'>Stake</h2>
        <p className='text-text-secondary text-sm'>
          Delegate to back this validator&apos;s voting power, or undelegate to start the
          unbonding period.
        </p>
      </header>

      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        <button
          type='button'
          onClick={() => request('delegate')}
          className={classNames(
            'inline-flex items-center justify-center gap-2 rounded-sm',
            'bg-primary-main px-4 py-2 text-sm font-medium text-base-black',
            'transition-colors hover:bg-primary-light',
          )}
        >
          <Coins className='h-4 w-4' />
          Delegate
        </button>
        <button
          type='button'
          onClick={() => request('undelegate')}
          className={classNames(
            'inline-flex items-center justify-center gap-2 rounded-sm',
            'border border-other-tonal-fill10 px-4 py-2 text-sm font-medium',
            'text-text-primary transition-colors hover:bg-other-tonal-fill5',
          )}
        >
          <MinusCircle className='h-4 w-4' />
          Undelegate
        </button>
      </div>

      {pendingHere && !connected && (
        <div className='flex flex-col gap-2 rounded-sm border border-other-tonal-fill10 bg-other-tonal-fill5 p-3'>
          <p className='text-sm text-text-secondary'>
            Connect your wallet to {pendingHere}. We&apos;ll open the form for this validator
            as soon as the wallet is ready.
          </p>
          <div className='w-fit'>
            <ConnectButton actionType='accent' variant='minimal' />
          </div>
        </div>
      )}
    </Surface>
  );
});

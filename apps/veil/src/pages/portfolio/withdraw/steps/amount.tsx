'use client';

import { useMemo, useState } from 'react';
import BigNumber from 'bignumber.js';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { pnum } from '@penumbra-zone/types/pnum';
import { getMetadata } from '@penumbra-zone/getters/value-view';

import { amountMoreThanBalance } from '@/pages/portfolio/withdraw/lib/ics20-withdraw';
import type { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets';

interface AmountStepProps {
  balance: ShieldedBalance;
  initialAmount: string;
  onBack: () => void;
  onNext: (amount: string) => void;
}

export function AmountStep({ balance, initialAmount, onBack, onNext }: AmountStepProps) {
  const metadata = getMetadata.optional(balance.valueView);
  const symbol = metadata?.symbol ?? '';

  const maxDisplay = useMemo(
    () => pnum(balance.valueView).toString(),
    [balance.valueView],
  );

  const [amount, setAmount] = useState(initialAmount || '');

  const tooBig = amount !== '' && amountMoreThanBalance(balance.balance, amount);
  const isPositive =
    amount !== '' && (() => {
      try {
        return new BigNumber(amount).isFinite() && new BigNumber(amount).gt(0);
      } catch {
        return false;
      }
    })();
  const isValid = isPositive && !tooBig;

  return (
    <div className='flex flex-col gap-4'>
      <Text variant='body' color='text.primary'>
        Amount
      </Text>
      <TextInput
        placeholder='0.0'
        value={amount}
        actionType={amount === '' || !tooBig ? 'default' : 'destructive'}
        endAdornment={
          <div className='flex items-center gap-2 pr-2'>
            <Text variant='detail' color='text.secondary'>
              {symbol}
            </Text>
            <button
              type='button'
              onClick={() => setAmount(maxDisplay)}
              className='rounded-md border border-primary-main/50 px-2 py-0.5 text-xs text-primary-light hover:bg-primary-main/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-main'
            >
              Max
            </button>
          </div>
        }
        onChange={val => setAmount(val)}
      />
      <div className='flex items-center justify-between'>
        <Text variant='detail' color='text.secondary'>
          Available: {maxDisplay} {symbol}
        </Text>
        {tooBig && (
          <Text variant='detail' color='destructive.main'>
            Insufficient balance
          </Text>
        )}
      </div>

      <Text variant='detail' color='text.secondary'>
        Penumbra transaction fees are paid separately from your shielded balance — the full amount above will arrive on the destination network.
      </Text>

      <div className='mt-2 flex items-center justify-between gap-2'>
        <Button priority='secondary' onClick={onBack}>
          Back
        </Button>
        <Button priority='primary' disabled={!isValid} onClick={() => onNext(amount)}>
          Review
        </Button>
      </div>
    </div>
  );
}

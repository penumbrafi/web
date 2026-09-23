'use client';

import { useState } from 'react';
import { ArrowRightLeft, Building2, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import dynamic from 'next/dynamic';

// The multi-chain widget lives inside DepositDialog; import lazily so its
// ~1.5MB of chain-registry + skip client only lands if the user picks it.
const DepositDialog = dynamic(
  () => import('@/features/deposit/deposit-dialog').then(m => ({ default: m.DepositDialog })),
  { ssr: false },
);

interface MethodSelectProps {
  onPickCex: () => void;
}

/**
 * Entry step: the user chooses whether they're moving funds in from an
 * exchange withdrawal (CEX-guided flow) or from another wallet they
 * already control (opens the existing multi-chain deposit dialog).
 */
export const MethodSelect = ({ onPickCex }: MethodSelectProps) => {
  const [walletFlowOpen, setWalletFlowOpen] = useState(false);

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='strong' color='text.primary'>
          Deposit to Penumbra
        </Text>
        <Text small color='text.secondary'>
          Choose where your funds are today. We'll walk you through the rest.
        </Text>
      </div>

      <div className='grid grid-cols-1 gap-3 tablet:grid-cols-2'>
        <MethodCard
          icon={Building2}
          title='From an exchange'
          description='Withdraw from Kraken, Binance, Coinbase and others directly to Penumbra.'
          onClick={onPickCex}
        />
        <MethodCard
          icon={ArrowRightLeft}
          title='From another wallet'
          description='Bring assets from another chain wallet you control.'
          onClick={() => setWalletFlowOpen(true)}
        />
      </div>

      {walletFlowOpen && (
        <DepositDialog isOpen={walletFlowOpen} onClose={() => setWalletFlowOpen(false)} />
      )}
    </div>
  );
};

const MethodCard = ({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) => (
  <button
    type='button'
    onClick={onClick}
    className='group flex flex-col gap-3 rounded-xl bg-other-tonal-fill5 p-5 text-left transition-colors hover:bg-other-tonal-fill10'
  >
    <div className='flex items-center justify-between'>
      <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-other-tonal-fill10 text-text-primary'>
        <Icon className='h-5 w-5' />
      </div>
      <ChevronRight className='h-4 w-4 text-text-secondary transition-transform group-hover:translate-x-0.5' />
    </div>
    <div className='flex flex-col gap-1'>
      <Text variant='strong' color='text.primary'>
        {title}
      </Text>
      <Text small color='text.secondary'>
        {description}
      </Text>
    </div>
  </button>
);

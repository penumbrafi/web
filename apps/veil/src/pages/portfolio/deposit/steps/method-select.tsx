'use client';

import { ArrowRightLeft, Building2, ChevronRight, type LucideIcon } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { ReadyToShield } from './ready-to-shield';

interface MethodSelectProps {
  onPickCex: () => void;
  onPickWallet: () => void;
}

/**
 * Entry step: the user chooses whether they're moving funds in from an
 * exchange withdrawal (CEX-guided flow) or from an Injective wallet they
 * already control.
 */
export const MethodSelect = ({ onPickCex, onPickWallet }: MethodSelectProps) => {
  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='strong' color='text.primary'>
          Deposit to Penumbra
        </Text>
        <Text small color='text.secondary'>
          Choose where your funds are today. We&apos;ll walk you through the rest.
        </Text>
      </div>

      {/* Renders nothing if no connected wallet has a positive balance
          on an IBC-connected chain — never adds clutter for first-time
          visitors who genuinely need the CEX flow. */}
      <ReadyToShield />

      <div className='grid grid-cols-1 gap-3 tablet:grid-cols-2'>
        <MethodCard
          icon={Building2}
          title='From an exchange'
          description='Withdraw to your Injective address, then move it into Penumbra.'
          onClick={onPickCex}
        />
        <MethodCard
          icon={ArrowRightLeft}
          title='From another wallet'
          description='Move funds you hold on Injective in Keplr or Leap.'
          onClick={onPickWallet}
        />
      </div>
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

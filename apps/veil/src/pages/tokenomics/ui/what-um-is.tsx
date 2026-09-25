import { Text } from '@penumbra-zone/ui/Text';
import { Coins, Vote, Fuel, type LucideIcon } from 'lucide-react';

interface RoleProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

const Role = ({ icon: Icon, title, body }: RoleProps) => (
  <div className='flex flex-col gap-3 rounded-xl bg-other-tonal-fill5 p-4 backdrop-blur-lg desktop:p-6'>
    <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-other-tonal-fill10'>
      <Icon className='h-5 w-5 text-base-white' />
    </div>
    <Text variant='large' color='text.primary'>
      {title}
    </Text>
    <Text small color='text.secondary'>
      {body}
    </Text>
  </div>
);

export const WhatUmIs = () => {
  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Text variant='h2' color='text.primary'>
          What UM is
        </Text>
        <Text body color='text.secondary'>
          UM is the native asset of the Penumbra network. It serves three jobs at the protocol
          layer.
        </Text>
      </div>
      <div className='grid grid-cols-1 gap-3 tablet:grid-cols-3'>
        <Role
          icon={Coins}
          title='Staking'
          body='Delegate UM to validators to secure the chain and earn staking rewards. Delegated UM also participates in the Liquidity Tournament.'
        />
        <Role
          icon={Vote}
          title='Governance'
          body='Stakers vote on protocol parameters, upgrades, and which assets receive incentives in each Liquidity Tournament epoch.'
        />
        <Role
          icon={Fuel}
          title='Fees & gas'
          body='UM pays for transactions, swaps, and on-chain DEX activity. It is also the unit the protocol uses to denominate burned arbitrage profit.'
        />
      </div>
    </section>
  );
};

import { Text } from '@penumbra-zone/ui/Text';
import { Coins, Droplets, Trophy, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { PagePath } from '@/shared/const/pages';

interface EarnLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  cta: string;
}

const EarnLink = ({ href, icon: Icon, label, description, cta }: EarnLinkProps) => (
  <Link
    href={href}
    className='group flex h-full flex-col gap-3 rounded-lg bg-other-tonal-fill5 p-5 transition-colors hover:bg-other-tonal-fill10'
  >
    <div className='flex h-9 w-9 items-center justify-center rounded-md bg-other-tonal-fill10'>
      <Icon className='h-5 w-5 text-base-white' />
    </div>
    <Text variant='strong' color='text.primary'>
      {label}
    </Text>
    <Text small color='text.secondary'>
      {description}
    </Text>
    <div className='mt-auto flex items-center gap-1 pt-2'>
      <Text technical color='text.primary'>
        {cta}
      </Text>
      <ArrowRight className='h-3.5 w-3.5 text-text-primary transition-transform group-hover:translate-x-0.5' />
    </div>
  </Link>
);

export const Earn = () => (
  <section className='flex flex-col gap-6'>
    <div className='flex flex-col gap-2'>
      <Text variant='h2' color='text.primary'>
        Earn UM
      </Text>
      <Text body color='text.secondary'>
        UM has three productive uses on Penumbra. Each is shielded by default and uses the
        same wallet.
      </Text>
    </div>
    <div className='grid grid-cols-1 gap-3 tablet:grid-cols-3'>
      <EarnLink
        href='/explore/validators'
        icon={Coins}
        label='Stake to validators'
        description='Delegate UM to active validators and earn issuance + chain fees. Unbonding period applies. Slashing risk if your validator misbehaves.'
        cta='Browse validators'
      />
      <EarnLink
        href={PagePath.Trade}
        icon={Droplets}
        label='Provide liquidity'
        description='Open a concentrated LP position around any price you choose. Earn the spread on every batch fill that crosses your range.'
        cta='Open trader'
      />
      <EarnLink
        href={PagePath.Tournament}
        icon={Trophy}
        label='Liquidity Tournament'
        description='Vote your delegation for a gauge each epoch. The winning gauges direct extra UM rewards to LPs in those pairs — and to you for voting.'
        cta='Open tournament'
      />
    </div>
  </section>
);

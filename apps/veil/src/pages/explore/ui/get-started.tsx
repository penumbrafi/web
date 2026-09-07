import { Text } from '@penumbra-zone/ui/Text';
import { Wallet, ArrowRightLeft, BookOpen } from 'lucide-react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

interface StepProps {
  href: string;
  icon: LucideIcon;
  step: string;
  title: string;
  body: string;
  external?: boolean;
}

const Step = ({ href, icon: Icon, step, title, body, external }: StepProps) => {
  const content = (
    <div className='group flex h-full flex-col gap-3 rounded-lg bg-other-tonal-fill5 p-4 transition-colors hover:bg-other-tonal-fill10'>
      <div className='flex items-center gap-2'>
        <div className='flex h-7 w-7 items-center justify-center rounded-md bg-other-tonal-fill10'>
          <Icon className='h-4 w-4 text-base-white' />
        </div>
        <Text small color='text.secondary'>
          {step}
        </Text>
      </div>
      <Text variant='strong' color='text.primary'>
        {title}
      </Text>
      <Text small color='text.secondary'>
        {body}
      </Text>
    </div>
  );

  if (external) {
    return (
      // eslint-disable-next-line react/jsx-no-target-blank -- want analytics referrers
      <a href={href} target='_blank'>
        {content}
      </a>
    );
  }

  return <Link href={href}>{content}</Link>;
};

export const GetStarted = () => (
  <section className='flex flex-col gap-4'>
    <Text variant='h3' color='text.primary'>
      Get started
    </Text>
    <div className='grid grid-cols-1 gap-3 tablet:grid-cols-3'>
      <Step
        external
        href='https://chromewebstore.google.com/detail/zafu-wallet-beta/bhlogefpcebekhjpomlodifcelldoimn'
        icon={Wallet}
        step='1.'
        title='Install a wallet'
        body='Zafu is the Penumbra-native wallet. It runs locally, holds your spend keys, and signs transactions in your browser — never on a server.'
      />
      <Step
        href='/portfolio'
        icon={ArrowRightLeft}
        step='2.'
        title='Shield assets'
        body='Deposit from any IBC chain through your wallet. USDC arrives via Noble with no wrapped tokens; ATOM, OSMO, TIA and every other IBC asset shield the same way.'
      />
      <Step
        href='/trade/UM/USDC'
        icon={BookOpen}
        step='3.'
        title='Trade'
        body='Place limit orders, market swaps, or LP a curve. Every swap fills at the block&apos;s uniform clearing price — no priority gas auctions.'
      />
    </div>
  </section>
);

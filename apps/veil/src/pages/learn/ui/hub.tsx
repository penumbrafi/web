import { Text } from '@penumbra-zone/ui/Text';
import {
  ExternalLink,
  Flame,
  HelpCircle,
  BookOpen,
  MessageSquare,
  MessagesSquare,
  ArrowLeftRight,
type  LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { LearnNav } from './learn-nav';

interface CardProps {
  href: string;
  external?: boolean;
  icon: LucideIcon;
  title: string;
  body: string;
}

const Card = ({ href, external, icon: Icon, title, body }: CardProps) => {
  const content = (
    <div className='group flex h-full flex-col gap-3 rounded-lg bg-other-tonal-fill5 p-5 transition-colors hover:bg-other-tonal-fill10'>
      <div className='flex items-center gap-2'>
        <div className='flex h-8 w-8 items-center justify-center rounded-md bg-other-tonal-fill10'>
          <Icon className='h-4 w-4 text-base-white' />
        </div>
        {external && (
          <ExternalLink className='h-3 w-3 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100' />
        )}
      </div>
      <Text variant='h3' color='text.primary'>
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

export const LearnHub = () => (
  <>
    <LearnNav />
    <section className='mx-auto flex max-w-[1062px] flex-col gap-8 p-4 desktop:gap-10 desktop:py-10'>
      <header className='flex flex-col gap-3'>
        <Text variant='h1' color='text.primary'>
          <span className='bg-gradient-to-r from-orange-400 to-teal-400 bg-clip-text text-transparent'>
            Learn Penumbra
          </span>
        </Text>
        <Text variant='large' color='text.secondary'>
          A shielded DEX that batch-clears every block. Balances, swaps, and LP positions
          are encrypted on-chain; the protocol — not searchers — captures the spread on
          your behalf and burns the proceeds.
        </Text>
      </header>

      <div className='grid grid-cols-1 gap-4 tablet:grid-cols-2 desktop:grid-cols-3'>
        <Card
          href='/learn/faq'
          icon={HelpCircle}
          title='FAQ'
          body='Quick answers about UM, shielded swaps, staking, IBC bridging, and how Penumbra prevents MEV.'
        />
        <Card
          href='/learn/tokenomics'
          icon={Flame}
          title='Tokenomics'
          body='Live supply, issuance, burns, and the math behind UM. How a busy DEX can drive net issuance below zero.'
        />
        <Card
          href='https://guide.penumbra.zone/'
          external
          icon={BookOpen}
          title='Penumbra guide'
          body='Hands-on walkthroughs from Penumbra Labs: running a node, building wallets, staking, governance, and using the DEX.'
        />
        <Card
          href='https://protocol.penumbra.zone/'
          external
          icon={BookOpen}
          title='Protocol spec'
          body='The reference for ZSwap, batch auctions, the shielded pool, and arbitrage execution.'
        />
        <Card
          href='https://discord.gg/penumbrazone'
          external
          icon={MessagesSquare}
          title='Discord community'
          body='Live chat with builders, validators, and traders. Help with wallets, IBC, hermes relayers, LQT, and more.'
        />
        <Card
          href='https://forum.penumbra.zone/'
          external
          icon={MessageSquare}
          title='Community forum'
          body='Long-form discussion on protocol upgrades, validator operations, governance proposals, and ecosystem ideas.'
        />
        <Card
          href='https://widget-nextjs.vercel.app/'
          external
          icon={ArrowLeftRight}
          title='IBC bridge tool'
          body='Move assets across IBC chains — Injective, Noble, Cosmos Hub, Osmosis, Penumbra, and more — with a single signed transaction.'
        />
        <Card
          href='https://penumbra.zone/'
          external
          icon={ExternalLink}
          title='penumbra.zone'
          body='Project site, whitepapers, blog posts, and ecosystem updates.'
        />
      </div>
    </section>
  </>
);

import { Text } from '@penumbra-zone/ui/Text';
import Link from 'next/link';
import { Eye, Zap, Coins } from 'lucide-react';
import { PagePath } from '@/shared/const/pages';
import { DEFAULT_PAIR } from '@/shared/config/featured-pairs';

const primaryCtaCx =
  'inline-flex items-center justify-center rounded-sm bg-primary-main px-4 py-2 text-sm font-medium text-base-black transition-colors hover:bg-primary-light';
const secondaryCtaCx =
  'inline-flex items-center justify-center rounded-sm border border-other-tonal-stroke bg-other-tonal-fill5 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-other-tonal-fill10';

/**
 * Home-page hero: short pitch on what Penumbra is and why this DEX is
 * different. Static (no DB). Sits above the live market stats.
 */
export const ExploreHero = () => {
  return (
    <div className='relative p-px'>
      {/* gradient border */}
      <div className='absolute top-0 right-0 bottom-0 left-0 z-10 rounded-xl [background:linear-gradient(110deg,rgba(186,77,20,1),rgba(186,77,20,0),rgba(34,99,98,0),rgba(34,99,98,1))]' />
      <div className='absolute top-1 right-1 bottom-1 left-1 z-20 rounded-xl bg-base-black-alt' />
      <div className='relative z-30 flex flex-col gap-6 rounded-xl p-6 backdrop-blur-lg [background:linear-gradient(110deg,rgba(186,77,20,0.18)_0%,rgba(34,99,98,0.10)_75%)] desktop:p-10'>
        <div className='flex flex-col gap-3'>
          <Text variant='h1' color='text.primary'>
            <span className='bg-gradient-to-r from-orange-400 to-teal-400 bg-clip-text text-transparent'>
              Shielded trading
            </span>
          </Text>
          <Text variant='large' color='text.secondary'>
            Penumbra is a DEX where balances, swaps, and LP positions are encrypted on-chain,
            and every block batch-clears at one uniform price. The protocol — not searchers —
            captures the spread on your behalf, and burns it. No MEV bots, no privileged
            routing, no gas auctions.
          </Text>
        </div>

        <div className='flex flex-wrap gap-2'>
          <Link
            className={primaryCtaCx}
            href={`/trade/${DEFAULT_PAIR.base}/${DEFAULT_PAIR.quote}`}
          >
            Start trading
          </Link>
          <Link className={secondaryCtaCx} href='/portfolio'>
            View portfolio
          </Link>
          <Link className={secondaryCtaCx} href={PagePath.Tokenomics}>
            How UM earns
          </Link>
        </div>

        <div className='grid grid-cols-1 gap-3 tablet:grid-cols-3'>
          <PillarCard
            icon={Eye}
            title='Shielded by default'
            body='Balances, swaps, and LP positions are encrypted on-chain. Only you can see your activity — no chain analysis, no front-running.'
          />
          <PillarCard
            icon={Zap}
            title='Batch-cleared, MEV-free'
            body='Every swap in a block fills at the same uniform price. Searchers can&apos;t reorder, sandwich, or bid you up — there is no order to extract from.'
          />
          <PillarCard
            icon={Coins}
            title='Arbitrage burned'
            body='When the protocol clears a price gap, the proceeds don&apos;t go to a searcher. They go to nobody — UM is removed from supply forever.'
          />
        </div>
      </div>
    </div>
  );
};

interface PillarCardProps {
  icon: typeof Eye;
  title: string;
  body: string;
}

const PillarCard = ({ icon: Icon, title, body }: PillarCardProps) => (
  <div className='flex flex-col gap-2 rounded-lg bg-base-black-alt/60 p-4 backdrop-blur'>
    <div className='flex h-8 w-8 items-center justify-center rounded-md bg-other-tonal-fill10'>
      <Icon className='h-4 w-4 text-base-white' />
    </div>
    <Text variant='strong' color='text.primary'>
      {title}
    </Text>
    <Text small color='text.secondary'>
      {body}
    </Text>
  </div>
);

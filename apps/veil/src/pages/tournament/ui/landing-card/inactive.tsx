import Link from 'next/link';
import { PauseCircle } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';

/**
 * Shown in place of the live round (incentive pool, results, voting) while the
 * chain is not funding the tournament. Nothing here is toggled by hand: it
 * renders whenever `useLqtStatus().active` is false and disappears the block
 * after governance funds a pool.
 */
export const TournamentInactive = () => (
  <div className='flex flex-col gap-4 rounded-lg border border-other-tonal-stroke bg-other-tonal-fill5 p-6'>
    <div className='flex items-center gap-2'>
      <PauseCircle className='h-5 w-5 text-text-secondary' aria-hidden />
      <Text variant='h4' color='text.primary'>
        Tournament paused
      </Text>
    </div>

    <Text small color='text.secondary'>
      No rewards are being paid right now, so there is nothing to vote on or earn this epoch.
    </Text>

    <Text small color='text.secondary'>
      The tournament comes back when it is funded through a governance proposal. This page reads
      that straight from the chain and switches back on by itself as soon as rewards start
      accruing — no need to check back for an announcement.
    </Text>

    <Text small color='text.secondary'>
      Past rounds, results and leaderboards are still available below.
    </Text>

    <Link
      href='/explore/governance'
      className='self-start text-sm text-primary-light hover:underline focus:outline-none focus-visible:underline'
    >
      Follow governance proposals →
    </Link>
  </div>
);

import Link from 'next/link';
import { PauseCircle } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';

/**
 * Shown above the live tally and the vote button while the chain is not
 * funding the tournament. Voting still works in an unfunded epoch, and its
 * tally is the best guide to which UM pair gets rewards once governance funds
 * a round, so the notice sits alongside the round instead of replacing it.
 * Nothing here is toggled by hand: it renders whenever `useLqtStatus().active`
 * is false and disappears the block after governance funds a pool.
 */
export const TournamentInactive = () => (
  <div className='flex flex-col gap-2 rounded-lg border border-other-tonal-stroke bg-other-tonal-fill5 p-4'>
    <div className='flex items-center gap-2'>
      <PauseCircle className='h-4 w-4 text-text-secondary' aria-hidden />
      <Text strong color='text.primary'>
        No rewards this epoch
      </Text>
    </div>
    <Text small color='text.secondary'>
      The tournament is waiting on a governance proposal to fund it. You can still vote: votes
      count for the epoch they are cast in, so if funding lands before this epoch ends, it pays
      out on the tally below, and the UM pairs over the threshold get the liquidity rewards. This
      page switches back on by itself when rewards start accruing.
    </Text>
    <Link
      href='/explore/governance'
      className='self-start text-sm text-primary-light hover:underline focus:outline-none focus-visible:underline'
    >
      Follow governance proposals →
    </Link>
  </div>
);

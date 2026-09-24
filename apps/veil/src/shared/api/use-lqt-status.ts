import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/shared/utils/api-fetch';
import type { TournamentStatus } from '@/shared/api/server/lqt-status';

const INACTIVE: TournamentStatus = { active: false, epoch: null, accruedRewards: '0' };

/**
 * Whether the Liquidity Tournament is live right now, as the chain reports it.
 *
 * Replaces the old hardcoded `LQT_ENABLED` const. Governance turns the
 * tournament on by funding it, the chain starts accruing a pool the next
 * block, and this flips on by itself; when the tournament's end block passes
 * the chain zeroes the pool and this flips off. See `lqt-status.ts` for why it
 * reads the ACCRUED pool rather than the summary view's projection.
 *
 * Reads as inactive while loading and on any error, so nothing advertises
 * rewards before the chain has confirmed them.
 */
export const useLqtStatus = () => {
  const query = useQuery({
    queryKey: ['lqt-status'],
    // Funding lands via a governance proposal and then accrues per block, so
    // a minute of staleness is invisible in practice. Polling rather than a
    // one-shot fetch is what makes "no const to flip" true for a tab that
    // stays open across the moment governance enacts it.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: () => apiFetch<TournamentStatus>('/api/tournament/status'),
  });

  const status = query.data ?? INACTIVE;
  return {
    ...status,
    isLoading: query.isPending,
  };
};

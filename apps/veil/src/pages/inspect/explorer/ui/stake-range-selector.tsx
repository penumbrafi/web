'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  DEFAULT_STAKE_RANGE,
  STAKE_RANGES,
  type StakeRangeKey,
} from './stake-range';

/**
 * URL-backed time-range picker for the active-stake-history chart.
 *
 * Lives entirely in the URL so the picker survives back/forward, share
 * links land on the same window, and Next.js's force-dynamic re-runs
 * the server fetch on every navigation. No client state.
 */
export const StakeRangeSelector = ({ current }: { current: StakeRangeKey }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const setRange = (key: StakeRangeKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (key === DEFAULT_STAKE_RANGE) {
      params.delete('range');
    } else {
      params.set('range', key);
    }
    const query = params.toString();
    const path = pathname ?? '';
    router.push(query ? `${path}?${query}` : path);
  };

  return (
    <div className='inline-flex gap-1 rounded-lg bg-other-tonal-fill5 p-1'>
      {STAKE_RANGES.map(r => {
        const active = r.key === current;
        return (
          <button
            key={r.key}
            type='button'
            onClick={() => setRange(r.key)}
            className={
              active
                ? 'rounded-md bg-other-tonal-fill10 px-3 py-1 font-mono text-xs text-text-primary'
                : 'rounded-md px-3 py-1 font-mono text-xs text-text-secondary transition-colors hover:text-text-primary'
            }
            aria-pressed={active}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
};

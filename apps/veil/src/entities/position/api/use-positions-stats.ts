import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiFetch } from '@/shared/utils/api-fetch.ts';
import { PositionsStatsResponse } from '@/shared/api/server/position/stats/types';

// The endpoint caps a request at 200 ids. Chunks follow the owned-id order,
// so a new position only changes the last chunk.
const CHUNK = 100;

export const usePositionsStats = (positionIds: string[]) => {
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < positionIds.length; i += CHUNK) {
      out.push(positionIds.slice(i, i + CHUNK));
    }
    return out;
  }, [positionIds]);

  return useQueries({
    queries: chunks.map(ids => ({
      // Order-independent within a chunk so the same set hits the same slot.
      queryKey: ['positionsStats', [...ids].sort()],
      staleTime: 60_000,
      // Fees accrue on fills; without this they froze while the table stayed open.
      refetchInterval: 60_000,
      queryFn: () =>
        apiFetch<PositionsStatsResponse>('/api/position/stats', {
          positionIds: ids.join(','),
        }),
    })),
    combine: results => {
      const done = results.filter(r => r.data);
      return {
        data:
          done.length === 0
            ? undefined
            : ({ items: done.flatMap(r => r.data?.items ?? []) } satisfies PositionsStatsResponse),
        isLoading: results.some(r => r.isLoading),
      };
    },
  });
};

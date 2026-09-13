import { useQuery } from '@tanstack/react-query';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';
import { apiFetch } from '@/shared/utils/api-fetch.ts';
import { RecentExecution } from '@/shared/api/server/recent-executions.ts';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block.ts';
import { useOnPindexerTick } from '@/shared/api/pindexer-stream.ts';

const LIMIT = 10;

export const useRecentExecutions = () => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();

  const query = useQuery({
    queryKey: ['recent-executions', baseSymbol, quoteSymbol],
    // Refetch on every new block via the compact-block stream instead of
    // a fixed 10s poll. Matches the book / candles / my-trades cadence
    // and keeps the trade tape at Penumbra's block rhythm (~5s).
    staleTime: Infinity,
    queryFn: async () => {
      return apiFetch<RecentExecution[]>('/api/recent-executions', {
        baseAsset: baseSymbol,
        quoteAsset: quoteSymbol,
        limit: String(LIMIT),
      });
    },
  });

  useRefetchOnNewBlock(['recent-executions', baseSymbol, quoteSymbol], query);
  // Push path: refetch the instant pindexer's dex_ex indexer commits a
  // new batch, rather than waiting for the compact-block gRPC stream
  // to tick and then racing to hit the API before pindexer has landed
  // the new row. Belt-and-suspenders with the block-height refetch
  // above — React Query dedups near-simultaneous invalidations.
  useOnPindexerTick(['dex_ex'], ['recent-executions', baseSymbol, quoteSymbol]);

  return query;
};

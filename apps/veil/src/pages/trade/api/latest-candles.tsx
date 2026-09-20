import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useOnPindexerTick } from '@/shared/api/pindexer-stream.ts';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';
import { DurationWindow } from '@/shared/utils/duration.ts';
import { CandleWithVolume } from '@/shared/api/server/candles/utils.ts';
import { apiFetch } from '@/shared/utils/api-fetch';

const CANDLES_LIMIT = 5;

/**
 * 5 latest candles, refetched on each pindexer `dex_ex` commit.
 *
 * placeholderData: keepPreviousData pairs with useInfiniteCandles so a
 * timeframe switch doesn't leave the chart undefined for the loading
 * window — both queries keep the previous timeframe's data until the new
 * one lands, and chart.tsx's seeding effect re-runs once new data
 * actually arrives.
 */
export const useLatestCandles = (durationWindow: DurationWindow, linearTime = true) => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();

  const query = useQuery<CandleWithVolume[]>({
    queryKey: ['latest-candles', baseSymbol, quoteSymbol, durationWindow, linearTime],
    placeholderData: keepPreviousData,
    // Symbols resolve from the route asynchronously; without this the
    // first mount fires `/api/candles?baseAsset=undefined`.
    enabled: !!baseSymbol && !!quoteSymbol,
    queryFn: async (): Promise<CandleWithVolume[]> => {
      return apiFetch<CandleWithVolume[]>('/api/candles', {
        baseAsset: baseSymbol,
        quoteAsset: quoteSymbol,
        limit: CANDLES_LIMIT,
        durationWindow,
        gapFill: linearTime ? '1' : '0',
      });
    },
  });

  // Push path: pindexer's dex_ex commit is the moment new candle
  // volume/high/low rows land — invalidate then, not later. Deliberately
  // NOT also refetching on compact-block height: that fetch predates the
  // pindexer commit, always returns the previous block's rows, and gets
  // clobbered ~200ms later by this tick — two requests per block for one
  // useful response.
  useOnPindexerTick(['dex_ex'], [
    'latest-candles',
    baseSymbol,
    quoteSymbol,
    durationWindow,
    linearTime,
  ]);

  return query;
};

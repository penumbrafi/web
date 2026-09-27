import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';
import { DurationWindow } from '@/shared/utils/duration.ts';
import { CandleWithVolume } from '@/shared/api/server/candles/utils.ts';
import { apiFetch } from '@/shared/utils/api-fetch';

const CANDLES_LIMIT = 100;

/**
 * Paginated candles query – requests 100 candles per page and wait for users to scroll the chart.
 *
 * placeholderData: keepPreviousData keeps the previous timeframe's candles
 * on screen while a new timeframe loads. Without this, the chart container
 * unmounts during the loading window (chart.tsx gates render on
 * !isLoading && historyCandles), tearing down the entire lightweight-charts
 * instance and forcing a full series rebuild on every timeframe switch.
 */
export const useInfiniteCandles = (durationWindow: DurationWindow, linearTime = true) => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();

  return useInfiniteQuery<CandleWithVolume[]>({
    queryKey: ['infinite-candles', baseSymbol, quoteSymbol, durationWindow, linearTime],
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    getNextPageParam: (lastPage, _, lastPageParam) => {
      // 1b is a live view: the server serves only the recent ~15-minute
      // window (an idle block stores nothing, so there is no archive), which
      // means scrolling back has nothing to fetch. Every other window pages
      // through pindexer's stored buckets normally.
      if (durationWindow === '1b') {
        return undefined;
      }
      return lastPage.length ? (lastPageParam as number) + 1 : undefined;
    },
    queryFn: async ({ pageParam }): Promise<CandleWithVolume[]> => {
      return apiFetch<CandleWithVolume[]>('/api/candles', {
        baseAsset: baseSymbol,
        quoteAsset: quoteSymbol,
        page: pageParam as number,
        limit: CANDLES_LIMIT,
        durationWindow,
        gapFill: linearTime ? '1' : '0',
      });
    },
  });
};

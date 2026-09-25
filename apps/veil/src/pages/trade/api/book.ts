import { useQuery } from '@tanstack/react-query';
import { useRefetchOnNewBlock } from '@/shared/api/compact-block.ts';
import { RouteBookResponse } from '@/shared/api/server/book/types';
import { deserializeRouteBookResponseJson } from '@/shared/api/server/book/serialization.ts';
import { RouteBookApiResponse } from '@/shared/api/server/book';
import { usePathSymbols } from '@/pages/trade/model/use-path.ts';

interface UseBookOptions {
  overrideBase?: string;
  overrideQuote?: string;
  // Client-requested number of levels per side. Server caps + defaults on
  // its own, so pass through raw; server caches per (base, quote, limit)
  // so distinct limits stay isolated.
  traceLimit?: number;
}

/**
 * React Query options for a pair's book, shared by `useBook` (the route
 * pair) and `usePortfolioMarketPrices` (an arbitrary set of per-position
 * pairs driven through `useQueries`). Centralizing this means both paths
 * read/write the same `['book', base, quote, traceLimit]` cache entries.
 */
export const bookQueryOptions = (
  baseSymbol: string | undefined,
  quoteSymbol: string | undefined,
  traceLimit?: number,
) => ({
  queryKey: ['book', baseSymbol, quoteSymbol, traceLimit],
  // Guard on both symbols being resolved. Without this, the query
  // fires on mount before the router has populated params and issues
  // /api/book?baseAsset=undefined&quoteAsset=undefined — the server
  // route bails with a 400/500 and floods the console.
  enabled: Boolean(baseSymbol) && Boolean(quoteSymbol),
  queryFn: async (): Promise<RouteBookResponse> => {
    // `enabled` above keeps this from ever running with a missing symbol; the
    // guard narrows both to string here without an assertion.
    if (!baseSymbol || !quoteSymbol) {
      throw new Error('book query ran without both symbols');
    }
    const paramsObj: Record<string, string> = {
      baseAsset: baseSymbol,
      quoteAsset: quoteSymbol,
    };
    if (traceLimit !== undefined && traceLimit > 0) {
      paramsObj['traceLimit'] = String(Math.floor(traceLimit));
    }
    const baseUrl = '/api/book';
    const urlParams = new URLSearchParams(paramsObj).toString();
    const res = await fetch(`${baseUrl}?${urlParams}`);
    const jsonRes = (await res.json()) as RouteBookApiResponse;
    if ('error' in jsonRes) {
      throw new Error(jsonRes.error);
    }
    return deserializeRouteBookResponseJson(jsonRes);
  },
});

export const useBook = (
  overrideBaseOrOpts?: string | UseBookOptions,
  overrideQuoteArg?: string,
) => {
  // Preserve the (base, quote) positional signature the older call-sites
  // still use — new call-sites can pass a single options object.
  const opts: UseBookOptions =
    typeof overrideBaseOrOpts === 'object'
      ? overrideBaseOrOpts
      : { overrideBase: overrideBaseOrOpts, overrideQuote: overrideQuoteArg };
  const pathSymbols = usePathSymbols();
  const baseSymbol = opts.overrideBase ?? pathSymbols.baseSymbol;
  const quoteSymbol = opts.overrideQuote ?? pathSymbols.quoteSymbol;
  const traceLimit = opts.traceLimit;

  const bothSymbolsPresent = Boolean(baseSymbol) && Boolean(quoteSymbol);

  const query = useQuery(bookQueryOptions(baseSymbol, quoteSymbol, traceLimit));

  // Dedup id must vary with the query key. `'routeBook'` alone was shared
  // by every mounted `useBook` (traceLimit undefined for useMarketPrice /
  // depth-overlay, 100 for the ladder), so `lastRefetchedBlockHeights`
  // recorded the first instance's tick and every other instance skipped
  // — one variant froze until the user's own swap invalidated `book`.
  // Include `traceLimit` so each variant refreshes on its own block tick.
  useRefetchOnNewBlock(
    ['routeBook', baseSymbol, quoteSymbol, traceLimit],
    query,
    !bothSymbolsPresent,
  );

  return query;
};

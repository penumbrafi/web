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

export const useBook = (
  overrideBaseOrOpts?: string | UseBookOptions,
  overrideQuoteArg?: string,
) => {
  // Preserve the (base, quote) positional signature the older call-sites
  // still use — new call-sites can pass a single options object.
  const opts: UseBookOptions =
    typeof overrideBaseOrOpts === 'object' && overrideBaseOrOpts !== null
      ? overrideBaseOrOpts
      : { overrideBase: overrideBaseOrOpts, overrideQuote: overrideQuoteArg };
  const pathSymbols = usePathSymbols();
  const baseSymbol = opts.overrideBase ?? pathSymbols.baseSymbol;
  const quoteSymbol = opts.overrideQuote ?? pathSymbols.quoteSymbol;
  const traceLimit = opts.traceLimit;

  // Guard on both symbols being resolved. Without this, the query
  // fires on mount before the router has populated params and issues
  // /api/book?baseAsset=undefined&quoteAsset=undefined — the server
  // route bails with a 400/500 and floods the console.
  const bothSymbolsPresent = Boolean(baseSymbol) && Boolean(quoteSymbol);

  const query = useQuery({
    queryKey: ['book', baseSymbol, quoteSymbol, traceLimit],
    enabled: bothSymbolsPresent,
    queryFn: async (): Promise<RouteBookResponse> => {
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

  useRefetchOnNewBlock('routeBook', query);

  return query;
};

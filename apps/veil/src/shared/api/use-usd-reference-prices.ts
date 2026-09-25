import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { referencePriceFor } from '@/shared/const/reference-price';

const REFRESH_MS = 60_000;

const fetchCoingeckoUsd = async (id: string): Promise<number | null> => {
  const params = new URLSearchParams({ ids: id });
  const res = await fetch(`/api/coingecko-price?${params.toString()}`);
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as Record<string, { usd?: number } | null>;
  const usd = data[id]?.usd;
  return typeof usd === 'number' && usd > 0 ? usd : null;
};

const fetchDerivedUsd = async (symbol: string): Promise<number | null> => {
  const res = await fetch(`/api/derived-usd-price?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { usd?: number };
  return typeof data.usd === 'number' && data.usd > 0 ? data.usd : null;
};

/**
 * USD reference price per symbol (upper-cased key), from the same intel the
 * LP form suggests prices with: stablecoin pegs, CoinGecko, and UM's
 * on-chain bridge VWAP. Symbols without intel, or whose source hasn't
 * answered, are absent.
 *
 * Exists because the book mid is a poor fair price on Penumbra's thin books:
 * with bids at 0.998 and the only asks a multi-hop route at 1.77, the
 * USDC.inj/USDC "mid" is 1.385, and every rung reads ~27% off it.
 */
export const useUsdReferencePrices = (symbols: string[]): Map<string, number> => {
  const unique = useMemo(() => [...new Set(symbols.map(s => s.toUpperCase()))].sort(), [symbols]);

  const queries = useQueries({
    queries: unique.map(symbol => {
      const src = referencePriceFor(symbol);
      if (src?.kind === 'coingecko') {
        return {
          queryKey: ['usd-reference', 'coingecko', src.id],
          queryFn: () => fetchCoingeckoUsd(src.id),
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        };
      }
      if (src?.kind === 'onchain-bridge') {
        return {
          queryKey: ['usd-reference', 'derived', symbol],
          queryFn: () => fetchDerivedUsd(symbol),
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        };
      }
      // Fixed pegs and unknown symbols need no fetch.
      return {
        queryKey: ['usd-reference', 'static', symbol],
        queryFn: () => (src?.kind === 'fixed' ? src.usd : null),
        staleTime: Infinity,
      };
    }),
  });

  const signature = queries.map((q, i) => `${unique[i]}:${q.data ?? ''}`).join(',');

  return useMemo(() => {
    const map = new Map<string, number>();
    queries.forEach((q, i) => {
      const symbol = unique[i];
      if (symbol && typeof q.data === 'number') {
        map.set(symbol, q.data);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized prices; `queries` is a fresh array every render
  }, [signature]);
};

/** Quote per base from USD reference prices, or undefined without intel for both. */
export const referenceMid = (
  usd: Map<string, number>,
  base: string | undefined,
  quote: string | undefined,
): number | undefined => {
  if (!base || !quote) {
    return undefined;
  }
  const b = usd.get(base.toUpperCase());
  const q = usd.get(quote.toUpperCase());
  if (b === undefined || q === undefined || q <= 0) {
    return undefined;
  }
  const mid = b / q;
  return Number.isFinite(mid) && mid > 0 ? mid : undefined;
};

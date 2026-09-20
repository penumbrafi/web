import { useEffect, useMemo, useState } from 'react';
import { referencePriceFor, ReferencePriceSource } from '@/shared/const/reference-price';

interface Result {
  /**
   * Suggested reference price = base_usd / quote_usd = "how many quote
   * per one base" (matches how veil expresses prices everywhere else).
   * `undefined` when either side has no intel — caller falls back to the
   * live market mid.
   */
  price?: number;
  /** For a small "Suggested: 1.00 (stablecoin peg)" hint chip. */
  source?: 'fixed' | 'coingecko' | 'mixed';
}

/**
 * Look up a suggested reference price for a pair using the per-asset
 * reference-price intel (stablecoin pegs + coingecko for major assets).
 * Called from the LP form to prefill the "Reference price" input on a
 * fresh pair.
 *
 * Precedence for the LP form is `user input → this → live mid → range
 * midpoint`. This hook is only the middle layer; the fall-back chain
 * lives in `LPFormStore.effectiveMarketPrice`.
 */
export const useReferencePrice = (
  baseSymbol: string | undefined,
  quoteSymbol: string | undefined,
): Result => {
  const baseSrc = useMemo(() => referencePriceFor(baseSymbol), [baseSymbol]);
  const quoteSrc = useMemo(() => referencePriceFor(quoteSymbol), [quoteSymbol]);

  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const ids = new Set<string>();
    const collect = (s: ReferencePriceSource | undefined) => {
      if (s?.kind === 'coingecko') ids.add(s.id);
    };
    collect(baseSrc);
    collect(quoteSrc);
    if (ids.size === 0) return;

    let cancelled = false;
    const params = new URLSearchParams({ ids: [...ids].join(',') });
    fetch(`/api/coingecko-price?${params.toString()}`)
      .then(r => (r.ok ? (r.json() as Promise<Record<string, { usd?: number }>>) : null))
      .then(data => {
        if (!data || cancelled) return;
        const next: Record<string, number> = {};
        for (const [id, row] of Object.entries(data)) {
          if (typeof row?.usd === 'number' && row.usd > 0) next[id] = row.usd;
        }
        setPrices(prev => ({ ...prev, ...next }));
      })
      .catch(() => {
        // Silent — caller falls back to live mid. A CoinGecko rate
        // limit or transient failure should never break the LP form.
      });
    return () => {
      cancelled = true;
    };
  }, [baseSrc, quoteSrc]);

  return useMemo(() => {
    const resolve = (src: ReferencePriceSource | undefined): number | undefined => {
      if (!src) return undefined;
      if (src.kind === 'fixed') return src.usd;
      return prices[src.id];
    };
    const baseUsd = resolve(baseSrc);
    const quoteUsd = resolve(quoteSrc);
    if (baseUsd === undefined || quoteUsd === undefined || quoteUsd <= 0) return {};
    const price = baseUsd / quoteUsd;
    if (!Number.isFinite(price) || price <= 0) return {};
    const kinds = new Set([baseSrc?.kind, quoteSrc?.kind]);
    const source = kinds.size === 1
      ? ([...kinds][0] as 'fixed' | 'coingecko')
      : 'mixed';
    return { price, source };
  }, [baseSrc, quoteSrc, prices]);
};

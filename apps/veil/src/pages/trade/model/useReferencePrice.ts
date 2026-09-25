import { useEffect, useMemo, useState } from 'react';
import { referencePriceFor, ReferencePriceSource } from '@/shared/const/reference-price';

/** One side of the derivation: the asset's USD price and where it came
 *  from. `bridge` / `depthUsd` are populated for `derived` (on-chain
 *  VWAP through a bridge). Used to render the "how we got this" tooltip
 *  on the Suggested chip so LPing into UM pairs is transparent, not a
 *  black box. */
export interface RefPriceLeg {
  symbol: string;
  usd: number;
  source: 'fixed' | 'coingecko' | 'derived';
  /** Bridge label like "USDC.inj" or "USDC.inj+1" (see derived-usd-price
   *  server module). Only set when source = derived. */
  bridge?: string;
  /** Combined VWAP depth across surviving bridges, USD. Only set when
   *  source = derived. */
  depthUsd?: number;
}

interface Result {
  /**
   * Suggested reference price = base_usd / quote_usd = "how many quote
   * per one base" (matches how veil expresses prices everywhere else).
   * `undefined` when either side has no intel — caller falls back to the
   * live market mid.
   */
  price?: number;
  /**
   * For the "Suggested: 1.00 (peg)" hint chip. `derived` = on-chain
   * bridge (UM). `mixed` = both sides resolved but from different kinds.
   */
  source?: 'fixed' | 'coingecko' | 'derived' | 'mixed';
  /** Per-side breakdown for the tooltip. Populated when `price` is. */
  base?: RefPriceLeg;
  quote?: RefPriceLeg;
}

interface DerivedRow {
  usd: number;
  bridge?: string;
  depthUsd?: number;
}

/**
 * Look up a suggested reference price for a pair using the per-asset
 * reference-price intel (stablecoin pegs + coingecko + on-chain bridges).
 * Called from the LP form to prefill the "Reference price" input on a
 * fresh pair, and to feed the derivation-breakdown tooltip.
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

  const [cgPrices, setCgPrices] = useState<Record<string, number>>({});
  const [derivedRows, setDerivedRows] = useState<Record<string, DerivedRow>>({});

  const baseSymUpper = baseSymbol?.toUpperCase();
  const quoteSymUpper = quoteSymbol?.toUpperCase();

  useEffect(() => {
    const ids = new Set<string>();
    const collect = (s: ReferencePriceSource | undefined) => {
      if (s?.kind === 'coingecko') {
        ids.add(s.id);
      }
    };
    collect(baseSrc);
    collect(quoteSrc);
    if (ids.size === 0) {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ ids: [...ids].join(',') });
    fetch(`/api/coingecko-price?${params.toString()}`)
      .then(r => (r.ok ? (r.json() as Promise<Record<string, { usd?: number }>>) : null))
      .then(data => {
        if (!data || cancelled) {
          return;
        }
        const next: Record<string, number> = {};
        for (const [id, row] of Object.entries(data)) {
          if (typeof row?.usd === 'number' && row.usd > 0) {
            next[id] = row.usd;
          }
        }
        setCgPrices(prev => ({ ...prev, ...next }));
      })
      .catch(() => {
        // Silent — caller falls back to live mid.
      });
    return () => {
      cancelled = true;
    };
  }, [baseSrc, quoteSrc]);

  useEffect(() => {
    const needed: string[] = [];
    if (baseSrc?.kind === 'onchain-bridge' && baseSymUpper) {
      needed.push(baseSymUpper);
    }
    if (quoteSrc?.kind === 'onchain-bridge' && quoteSymUpper) {
      needed.push(quoteSymUpper);
    }
    if (needed.length === 0) {
      return;
    }

    let cancelled = false;
    // each fetch catches to null, so this never rejects
    void Promise.all(
      needed.map(sym =>
        fetch(`/api/derived-usd-price?symbol=${encodeURIComponent(sym)}`)
          .then(r =>
            r.ok
              ? (r.json() as Promise<{ usd?: number; bridge?: string; depthUsd?: number }>)
              : null,
          )
          .then(j =>
            j && typeof j.usd === 'number' && j.usd > 0
              ? ([sym, { usd: j.usd, bridge: j.bridge, depthUsd: j.depthUsd }] as const)
              : null,
          )
          .catch(() => null),
      ),
    ).then(pairs => {
      if (cancelled) {
        return;
      }
      const next: Record<string, DerivedRow> = {};
      for (const p of pairs) {
        if (p) {
          next[p[0]] = p[1];
        }
      }
      if (Object.keys(next).length > 0) {
        setDerivedRows(prev => ({ ...prev, ...next }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [baseSrc, quoteSrc, baseSymUpper, quoteSymUpper]);

  return useMemo(() => {
    const buildLeg = (
      src: ReferencePriceSource | undefined,
      sym: string | undefined,
    ): RefPriceLeg | undefined => {
      if (!src || !sym) {
        return undefined;
      }
      if (src.kind === 'fixed') {
        return { symbol: sym, usd: src.usd, source: 'fixed' };
      }
      if (src.kind === 'coingecko') {
        const usd = cgPrices[src.id];
        if (usd === undefined || usd <= 0) {
          return undefined;
        }
        return { symbol: sym, usd, source: 'coingecko' };
      }
      if (src.kind === 'onchain-bridge') {
        const row = derivedRows[sym.toUpperCase()];
        if (!row) {
          return undefined;
        }
        return {
          symbol: sym,
          usd: row.usd,
          source: 'derived',
          bridge: row.bridge,
          depthUsd: row.depthUsd,
        };
      }
      return undefined;
    };

    const base = buildLeg(baseSrc, baseSymbol);
    const quote = buildLeg(quoteSrc, quoteSymbol);
    if (!base || !quote || quote.usd <= 0) {
      return {};
    }
    const price = base.usd / quote.usd;
    if (!Number.isFinite(price) || price <= 0) {
      return {};
    }
    const kinds = new Set([base.source, quote.source]);
    const source = kinds.size === 1 ? base.source : 'mixed';
    return { price, source, base, quote };
  }, [baseSrc, quoteSrc, baseSymbol, quoteSymbol, cgPrices, derivedRows]);
};

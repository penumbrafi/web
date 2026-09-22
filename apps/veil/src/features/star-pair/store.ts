import { makeAutoObservable } from 'mobx';
import { Pair, getStarredPairs, setStarredPairs } from './storage';
import { referencePriceFor } from '@/shared/const/reference-price';

// Canonicalize an unordered pair to a single key so UM/USDC and
// USDC/UM count as the same star. Users flip in-place from the pair
// selector, so we don't want two rows in the Starred list.
const pairKey = (pair: Pair): string =>
  [pair.base.symbol, pair.quote.symbol].sort().join('|');

// A symbol is "stable" iff reference-price.ts pegs it to a fixed $1.
// Sourcing from REFERENCE_PRICES keeps this rule in sync with the
// single source of truth for asset intel — adding a new stablecoin
// there automatically fixes its canonical direction here.
const isStable = (symbol: string | undefined): boolean => {
  const src = referencePriceFor(symbol);
  return src?.kind === 'fixed' && src.usd === 1;
};

const isBridge = (symbol: string | undefined): boolean =>
  referencePriceFor(symbol)?.kind === 'onchain-bridge';

/**
 * Canonicalize display direction of a starred pair so the Starred
 * sidebar always reads the "natural" way regardless of which route the
 * user clicked star on.
 *
 * Rules, in order:
 *   1. Quote is a stablecoin → already canonical (risk / stable).
 *   2. Base is stable, quote is not → swap.
 *   3. Neither is stable → prefer the on-chain-bridge asset (UM) as
 *      base; otherwise fall back to alphabetical symbol order for a
 *      deterministic pick.
 */
export const canonicalizeDirection = (pair: Pair): Pair => {
  const baseSym = pair.base.symbol;
  const quoteSym = pair.quote.symbol;

  if (isStable(quoteSym)) return pair;
  if (isStable(baseSym)) return { base: pair.quote, quote: pair.base };

  const baseIsBridge = isBridge(baseSym);
  const quoteIsBridge = isBridge(quoteSym);
  if (baseIsBridge && !quoteIsBridge) return pair;
  if (quoteIsBridge && !baseIsBridge) return { base: pair.quote, quote: pair.base };

  // Deterministic tiebreak: alphabetical symbol order.
  return baseSym.localeCompare(quoteSym) <= 0
    ? pair
    : { base: pair.quote, quote: pair.base };
};

class StarStateStore {
  pairs: Pair[] = [];
  private hydrated = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    // Hydrate eagerly when the module loads client-side. SSR is
    // guarded inside getStarredPairs (returns []); on the client
    // hydration this runs once and populates the starred list so
    // favorites survive reloads. Without this, the store starts empty
    // every render and the Starred section disappears.
    this.hydrate();
  }

  hydrate = () => {
    if (this.hydrated) return;
    if (typeof window === 'undefined') return;
    const raw = getStarredPairs();
    // Migrate any pre-existing localStorage state that stored both
    // directions of the same market as separate stars — collapse to one.
    const seen = new Set<string>();
    const deduped: Pair[] = [];
    let mutated = false;
    for (const p of raw) {
      const key = pairKey(p);
      if (seen.has(key)) {
        mutated = true;
        continue;
      }
      seen.add(key);
      const canon = canonicalizeDirection(p);
      if (canon.base.symbol !== p.base.symbol) mutated = true;
      deduped.push(canon);
    }
    this.pairs = deduped;
    if (mutated) setStarredPairs(deduped);
    this.hydrated = true;
  };

  star = (pair: Pair) => {
    // No dupes: same unordered pair, either direction, stays one entry.
    const canon = canonicalizeDirection(pair);
    const key = pairKey(canon);
    if (this.pairs.some(p => pairKey(p) === key)) return;
    this.pairs = [...this.pairs, canon];
    setStarredPairs(this.pairs);
  };

  unstar = (pair: Pair) => {
    const key = pairKey(pair);
    this.pairs = this.pairs.filter(p => pairKey(p) !== key);
    setStarredPairs(this.pairs);
  };

  isStarred = (pair: Pair): boolean => {
    const key = pairKey(pair);
    return this.pairs.some(p => pairKey(p) === key);
  };
}

export const starStore = new StarStateStore();

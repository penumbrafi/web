import React, { useCallback, useEffect, useMemo, useState } from 'react';
import cn from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { pnum } from '@penumbra-zone/types/pnum';
import { usePathSymbols } from '../../model/use-path';
import { useBook } from '../../api/book';
import type { Trace } from '@/shared/api/server/book/types';
import { calculateCumulativeDepthByPrice } from './utils';
import { simulateMarketBase } from './simulation';
import { RouteBookLoadingRow } from './loading-row';
import { TradeRow } from './trade-row';
import { SpreadRow } from './spread-row';
import { RouteBookHeader } from './header-row';
import { DepthCurve } from './depth-curve';
import { tradeFormStore } from '../order-form/store/OrderFormStore';

const CUMULATIVE_KEY = 'veil-route-book-cumulative';
const AGG_KEY = 'veil-route-book-agg';
const VIEW_KEY = 'veil-route-book-view';

// null = raw (no bucketing). Values are percent-of-mid bucket widths.
type AggPct = number | null;
const AGG_OPTIONS: readonly AggPct[] = [
  null,
  0.01,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
  25,
  50,
];
const AGG_LABEL = (v: AggPct) => (v === null ? 'raw' : `${v}%`);

type ViewMode = 'both' | 'bids' | 'asks';
const VIEW_OPTIONS: readonly ViewMode[] = ['both', 'bids', 'asks'];
const VIEW_LABEL: Record<ViewMode, string> = {
  both: 'Both',
  bids: 'Bids',
  asks: 'Asks',
};

// Hard cap on rows the trader sees. Beyond that the panel doesn't fit and
// bucketing is the right lever to compress info instead of scrolling.
const CAP_PER_SIDE = 10;
const CAP_ONE_SIDE = 20;

const readCumulativePref = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CUMULATIVE_KEY) === '1';
};

const readAggPref = (): AggPct => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AGG_KEY);
  if (raw === null || raw === 'raw') return null;
  const n = Number(raw);
  return Number.isFinite(n) && AGG_OPTIONS.includes(n) ? n : null;
};

const readViewPref = (): ViewMode => {
  if (typeof window === 'undefined') return 'both';
  const raw = window.localStorage.getItem(VIEW_KEY);
  return raw === 'bids' || raw === 'asks' ? raw : 'both';
};

// Aggregate adjacent traces whose prices round to the same bucket. `hops`
// on the merged row is taken from the shortest-path trace in the bucket
// so the Direct/Hop label stays truthful for the bulk of the liquidity.
const bucketTraces = (rows: Trace[], bucketSize: number): Trace[] => {
  if (!bucketSize || bucketSize <= 0) return rows;
  interface Bucket {
    price: number;
    amount: number;
    total: number;
    hops: Trace['hops'];
    minHopLen: number;
  }
  const buckets = new Map<number, Bucket>();
  for (const r of rows) {
    const p = pnum(r.price).toNumber();
    if (!Number.isFinite(p) || p <= 0) continue;
    const key = Math.round(p / bucketSize) * bucketSize;
    const amt = pnum(r.amount).toNumber();
    const tot = pnum(r.total).toNumber();
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        price: key,
        amount: amt,
        total: tot,
        hops: r.hops,
        minHopLen: r.hops.length,
      });
    } else {
      existing.amount += amt;
      existing.total += tot;
      if (r.hops.length < existing.minHopLen) {
        existing.hops = r.hops;
        existing.minHopLen = r.hops.length;
      }
    }
  }
  // Preserve DESCENDING price order (matches the raw traces).
  return [...buckets.values()]
    .sort((a, b) => b.price - a.price)
    .map(b => ({
      price: String(b.price),
      amount: String(b.amount),
      total: String(b.total),
      hops: b.hops,
    }));
};

// Click on a sell row → user wants to buy at the asking price.
// Click on a buy row  → user wants to sell into that bid.
// Mirrors TradingView / Binance behavior.
const prefillFromBookRow = (price: string, isSell: boolean) => {
  tradeFormStore.setWhichForm('Limit');
  tradeFormStore.limitForm.setDirection(isSell ? 'buy' : 'sell');
  tradeFormStore.limitForm.setPriceInput(price);
};

/**
 * Walk levels in display order and replace each row's `total` with the
 * cumulative sum from the touch outward. Sell rows are rendered top-down
 * with worst-price first; we accumulate from the *last* row (closest to
 * the spread) up. Buy rows are rendered top-down with best bid first; we
 * accumulate from the *first* row down.
 */
const accumulate = (rows: Trace[], side: 'sell' | 'buy'): Trace[] => {
  const out = new Array<Trace>(rows.length);
  let running = 0;
  if (side === 'sell') {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      running += pnum(r.total).toNumber();
      out[i] = { ...r, total: running.toString() };
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      running += pnum(r.total).toNumber();
      out[i] = { ...r, total: running.toString() };
    }
  }
  return out;
};

export const RouteBook = observer(() => {
  // Fetch a deep book (100 rows/side) so aggregation buckets always have
  // enough underlying levels to summarize, and so RouteDepth's cache
  // shares the same key.
  const { data, isLoading, error: bookErr } = useBook({ traceLimit: 100 });
  const [cumulative, setCumulative] = useState(false);
  const [agg, setAgg] = useState<AggPct>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('both');

  useEffect(() => {
    setCumulative(readCumulativePref());
    setAgg(readAggPref());
    setViewMode(readViewPref());
  }, []);

  const toggleCumulative = () => {
    setCumulative(c => {
      const next = !c;
      try {
        window.localStorage.setItem(CUMULATIVE_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const chooseAgg = useCallback((v: AggPct) => {
    setAgg(v);
    try {
      window.localStorage.setItem(AGG_KEY, v === null ? 'raw' : String(v));
    } catch {
      // ignore storage errors
    }
  }, []);

  const chooseView = useCallback((v: ViewMode) => {
    setViewMode(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore storage errors
    }
  }, []);

  const multiHops = data?.multiHops;
  const pair = usePathSymbols();

  // Compute mid from the raw traces (highest bid + lowest ask / 2) so the
  // aggregation bucket has a scale to work with even when the visible
  // sell side happens to be empty after slicing.
  const mid = useMemo<number | undefined>(() => {
    if (!multiHops?.buy.length || !multiHops.sell.length) return undefined;
    let hi = 0;
    let lo = Infinity;
    for (const t of multiHops.buy) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > hi) hi = p;
    }
    for (const t of multiHops.sell) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > 0 && p < lo) lo = p;
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= 0) return undefined;
    return (hi + lo) / 2;
  }, [multiHops]);

  const bucketSize = useMemo(() => {
    if (agg === null || mid === undefined) return 0;
    return mid * (agg / 100);
  }, [agg, mid]);

  const bucketedSell = useMemo(() => {
    if (!multiHops) return [];
    return bucketSize > 0 ? bucketTraces(multiHops.sell, bucketSize) : multiHops.sell;
  }, [multiHops, bucketSize]);
  const bucketedBuy = useMemo(() => {
    if (!multiHops) return [];
    return bucketSize > 0 ? bucketTraces(multiHops.buy, bucketSize) : multiHops.buy;
  }, [multiHops, bucketSize]);

  // Cap the visible rows so the panel always fits. `sellRows` needs the
  // rows CLOSEST to the spread — those sit at the END of a DESC-sorted
  // list (lowest ask is last). `buyRows` needs those closest to spread
  // at the TOP, which is the START of a DESC-sorted list (highest bid).
  const sellDisplay = useMemo<Trace[]>(() => {
    if (viewMode === 'bids') return [];
    const cap = viewMode === 'asks' ? CAP_ONE_SIDE : CAP_PER_SIDE;
    return bucketedSell.slice(-cap);
  }, [bucketedSell, viewMode]);
  const buyDisplay = useMemo<Trace[]>(() => {
    if (viewMode === 'asks') return [];
    const cap = viewMode === 'bids' ? CAP_ONE_SIDE : CAP_PER_SIDE;
    return bucketedBuy.slice(0, cap);
  }, [bucketedBuy, viewMode]);

  const sellRows = useMemo(
    () => (cumulative ? accumulate(sellDisplay, 'sell') : sellDisplay),
    [sellDisplay, cumulative],
  );
  const buyRows = useMemo(
    () => (cumulative ? accumulate(buyDisplay, 'buy') : buyDisplay),
    [buyDisplay, cumulative],
  );

  // Bar background = always a cumulative-depth staircase from the touch
  // outward, normalized to the deepest visible row = 100%. That reads as
  // a step-curve depth graph behind the price ladder (MEXC / Binance /
  // OKX default depth tint), independent of what the `Total` column
  // shows numerically — the `1:1 / Σ` toggle only affects the number,
  // not the bar shape. Keyed by price so the row-index vs total-string
  // mapping doesn't drift when bucketing rounds two rows to the same
  // total.
  //
  // Memoize on the row arrays — useBook polls every block (~5s), so on
  // pairs with deep books this iterates 30+ rows twice per refetch. The
  // map identity also matters: stable references mean child <TradeRow>
  // memoization doesn't bust on every block.
  const sellRelativeSizes = useMemo(
    () => calculateCumulativeDepthByPrice(sellDisplay, 'sell'),
    [sellDisplay],
  );
  const buyRelativeSizes = useMemo(
    () => calculateCumulativeDepthByPrice(buyDisplay, 'buy'),
    [buyDisplay],
  );

  // Simulate the current draft order against the raw book (pre-bucketing)
  // so the fill walks real per-position inventory, not summarized totals.
  // Then bin the fills onto whatever level (raw or bucketed) is being
  // rendered so the highlight lands on the visible row.
  const marketSim = useMemo(() => {
    if (
      tradeFormStore.whichForm !== 'Market' ||
      !multiHops ||
      !multiHops.buy.length ||
      !multiHops.sell.length
    ) {
      return undefined;
    }
    const market = tradeFormStore.marketForm;
    const base = market.baseInputAmount;
    if (!base || base <= 0) return undefined;
    return simulateMarketBase(market.direction, base, multiHops.buy, multiHops.sell);
  }, [multiHops]); // observer + market inputs pull re-render via mobx

  // Project the fill fractions from raw prices onto the currently rendered
  // (possibly bucketed) rows. When bucketing is on, a bucket row is
  // marked filled at the max fill fraction of any raw level inside it.
  const fillByRenderedPrice = useMemo<Map<string, number>>(() => {
    if (!marketSim || !multiHops) return new Map();
    // Fast path — no bucketing means visible rows use the raw price keys.
    if (bucketSize <= 0) return marketSim.fills;
    const consumed: Array<{ price: number; fraction: number }> = [];
    for (const [rawPriceStr, fraction] of marketSim.fills) {
      const p = pnum(rawPriceStr).toNumber();
      if (Number.isFinite(p) && fraction > 0) consumed.push({ price: p, fraction });
    }
    const out = new Map<string, number>();
    // Map each raw fill to its bucket key exactly the way bucketTraces did.
    for (const c of consumed) {
      const key = Math.round(c.price / bucketSize) * bucketSize;
      const bucketKey = String(key);
      const prior = out.get(bucketKey) ?? 0;
      if (c.fraction > prior) out.set(bucketKey, c.fraction);
    }
    return out;
  }, [marketSim, multiHops, bucketSize]);

  // Limit form: highlight the row (bucket) the resting price sits in.
  const limitFillPrice = useMemo<string | undefined>(() => {
    if (tradeFormStore.whichForm !== 'Limit') return undefined;
    const raw = tradeFormStore.limitForm.priceInput;
    const p = raw ? Number(raw) : NaN;
    if (!Number.isFinite(p) || p <= 0) return undefined;
    if (bucketSize > 0) {
      const key = Math.round(p / bucketSize) * bucketSize;
      return String(key);
    }
    return String(p);
  }, [bucketSize]);

  // Stable click handlers — without useCallback these would be fresh
  // function references on every render, busting any future memo() on
  // <TradeRow>. The handlers don't depend on any state inside the
  // component, so empty deps are safe.
  const onSellClick = useCallback((price: string) => prefillFromBookRow(price, true), []);
  const onBuyClick = useCallback((price: string) => prefillFromBookRow(price, false), []);

  if (bookErr) {
    return (
      <div className='flex min-h-[600px] items-center justify-center p-4'>
        <BlockchainError
          message='An error occurred while loading data from the blockchain'
          direction='column'
        />
      </div>
    );
  }

  const aggIdx = AGG_OPTIONS.indexOf(agg);
  const stepAgg = (delta: number) => {
    const next = AGG_OPTIONS[Math.max(0, Math.min(AGG_OPTIONS.length - 1, aggIdx + delta))];
    if (next !== undefined) chooseAgg(next);
  };
  const controls = (
    <div className='flex flex-wrap items-center justify-between gap-2 px-4 pt-2 text-[10px] leading-none text-text-secondary'>
      {/* Aggregation as a stepper: prev / current / next. Same range of
          choices as the pill row, but only three targets to hit instead
          of seven. */}
      <div className='flex items-center gap-1'>
        <span className='mr-0.5'>Agg</span>
        <button
          type='button'
          onClick={() => stepAgg(-1)}
          disabled={aggIdx <= 0}
          className='flex h-5 w-5 items-center justify-center rounded-sm bg-other-tonal-fill5 text-text-secondary transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-other-tonal-fill5'
          title='Finer bucketing'
        >
          <ChevronLeft className='h-3 w-3' />
        </button>
        <span className='min-w-[36px] rounded-sm bg-other-tonal-fill5 px-1.5 py-0.5 text-center tabular-nums text-text-primary'>
          {AGG_LABEL(agg)}
        </span>
        <button
          type='button'
          onClick={() => stepAgg(1)}
          disabled={aggIdx >= AGG_OPTIONS.length - 1}
          className='flex h-5 w-5 items-center justify-center rounded-sm bg-other-tonal-fill5 text-text-secondary transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-other-tonal-fill5'
          title='Coarser bucketing'
        >
          <ChevronRight className='h-3 w-3' />
        </button>
      </div>
      {/* View mode stays as a 3-toggle group — these are qualitatively
          different views, not steps along a scale, so a stepper would
          hide identity. */}
      <div className='flex items-center gap-1'>
        {/* Level vs cumulative toggle. The Total column header also
            toggles this, but the header text is tiny; a pill up here in
            the control row makes the option discoverable. */}
        <button
          type='button'
          onClick={toggleCumulative}
          className={cn(
            'rounded-sm px-1.5 py-0.5 transition-colors',
            cumulative
              ? 'bg-primary-main text-base-black'
              : 'bg-other-tonal-fill5 hover:bg-action-hover-overlay hover:text-text-primary',
          )}
          title={
            cumulative
              ? 'Showing cumulative total from the touch — click for per-level'
              : 'Showing per-level total — click for cumulative Σ'
          }
        >
          {cumulative ? 'Σ' : '1:1'}
        </button>
        {VIEW_OPTIONS.map(v => (
          <button
            key={v}
            type='button'
            onClick={() => chooseView(v)}
            className={cn(
              'rounded-sm px-1.5 py-0.5 transition-colors',
              v === viewMode
                ? 'bg-primary-main text-base-black'
                : 'bg-other-tonal-fill5 hover:bg-action-hover-overlay hover:text-text-primary',
            )}
            title={
              v === 'both'
                ? 'Show both bids and asks'
                : v === 'bids'
                  ? 'Bids only'
                  : 'Asks only'
            }
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );

  if (isLoading || !multiHops) {
    return (
      <div>
        {controls}
        <div className='mt-2 grid w-full auto-rows-[32px] grid-cols-[1fr_1fr_1fr_1fr] gap-x-2'>
          <RouteBookHeader
            quote={pair.quoteSymbol}
            base={pair.baseSymbol}
            cumulative={cumulative}
            onToggleCumulative={toggleCumulative}
          />
          {Array(17)
            .fill(1)
            .map((_, i) => (
              <RouteBookLoadingRow isSpread={i === 8} key={i} />
            ))}
        </div>
      </div>
    );
  }

  const showSpread = viewMode === 'both';

  // Grid-row bookkeeping for the DepthCurve SVGs. Row 1 = header;
  // sells start at 2 and take n_sells rows; the spread row (if
  // shown) then eats one row; buys follow. Same math the
  // <SpreadRow> visually implies but explicit so the SVGs can span
  // the correct rows via `grid-row: A / span B`.
  const sellGridStart = 2;
  const buyGridStart = sellGridStart + sellRows.length + (showSpread ? 1 : 0);

  return (
      <>
        {controls}
        <div className='mt-2 grid w-full auto-rows-[32px] grid-cols-[1fr_1fr_1fr_1fr] items-center gap-x-2'>
          <RouteBookHeader
            quote={pair.quoteSymbol}
            base={pair.baseSymbol}
            cumulative={cumulative}
            onToggleCumulative={toggleCumulative}
          />

          {/*
            DepthCurve SVGs sit before the rows in source order so the
            rows paint on top of the fill (keeping click targets and
            hover states intact). Two independent SVGs, one per side,
            each stretched via preserveAspectRatio='none' to match its
            side's block height.
          */}
          <DepthCurve
            rows={sellRows}
            relativeSizes={sellRelativeSizes}
            side='sell'
            gridRowStart={sellGridStart}
          />
          <DepthCurve
            rows={buyRows}
            relativeSizes={buyRelativeSizes}
            side='buy'
            gridRowStart={buyGridStart}
          />

          {sellRows.map((trace, idx) => (
            // Use idx as the key, not price+idx. The Nth sell row stays
            // the Nth sell row across book updates even when its price
            // moves — keying on price would unmount/remount the entire
            // row DOM subtree on every level shift, killing CSS
            // transitions and triggering paint thrash on each block.
            <TradeRow
              key={`sell-${idx}`}
              trace={trace}
              isSell={true}
              relativeSize={sellRelativeSizes.get(trace.price) ?? 0}
              onClick={onSellClick}
              fillFraction={
                fillByRenderedPrice.get(trace.price) ??
                (limitFillPrice === trace.price ? 1 : undefined)
              }
              depthBar={false}
            />
          ))}

          {showSpread && <SpreadRow sellOrders={multiHops.sell} buyOrders={multiHops.buy} />}

          {buyRows.map((trace, idx) => (
            <TradeRow
              key={`buy-${idx}`}
              trace={trace}
              isSell={false}
              relativeSize={buyRelativeSizes.get(trace.price) ?? 0}
              onClick={onBuyClick}
              fillFraction={
                fillByRenderedPrice.get(trace.price) ??
                (limitFillPrice === trace.price ? 1 : undefined)
              }
              depthBar={false}
            />
          ))}
        </div>
      </>
    );
});

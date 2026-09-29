import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cn from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { pnum } from '@penumbrafi/types/pnum';
import { usePathSymbols } from '../../model/use-path';
import { useBookV2 } from '../../api/book-v2';
import { bucketPrice, levelPriceString } from '@/shared/api/server/book/v2/levels';
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
const AGG_OPTIONS: readonly AggPct[] = [null, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50];
const AGG_LABEL = (v: AggPct) => (v === null ? 'raw' : `${v}%`);

type ViewMode = 'both' | 'bids' | 'asks';
const VIEW_OPTIONS: readonly ViewMode[] = ['both', 'bids', 'asks'];
const VIEW_LABEL: Record<ViewMode, string> = {
  both: 'Both',
  bids: 'Bids',
  asks: 'Asks',
};
const VIEW_TITLE: Record<ViewMode, string> = {
  both: 'Show both bids and asks',
  bids: 'Bids only',
  asks: 'Asks only',
};

/** Hover title and inline text for the placeholder row of an empty book side. */
const emptySideCopy = (
  side: 'buy' | 'sell' | null,
  base: string,
  quote: string,
): { title: string; text: string } => {
  if (side === 'buy') {
    return {
      title: `No direct bids for ${base} (routed liquidity may still fill a market sell) — post a buy limit order to become the first bid.`,
      text: `No direct bids · be the first to buy ${base}`,
    };
  }
  if (side === 'sell') {
    return {
      title: `No direct asks for ${base} (routed liquidity may still fill a market buy) — post a sell limit order to become the first ask.`,
      text: `No direct asks · be the first to sell ${base}`,
    };
  }
  return {
    title: `No direct positions on ${base}/${quote} (multi-hop routes may still trade it) — provide the first LP to bootstrap the pair.`,
    text: `No direct liquidity · be the first LP on ${base}/${quote}`,
  };
};

// Rows the trader sees per side by default. Beyond that the panel doesn't
// fit and bucketing is the right lever to compress info; "Load more" at the
// outer end of a side grows it on demand.
const CAP_PER_SIDE = 10;
const CAP_ONE_SIDE = 20;
const LOAD_MORE_ROWS = 10;
// Levels per side per /api/book/v2 page. One page covers the default view
// (and the one-side view); more pages load only when asked for.
const LEVELS_PER_PAGE = 20;

const readCumulativePref = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(CUMULATIVE_KEY) === '1';
};

const readAggPref = (): AggPct => {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(AGG_KEY);
  if (raw === null || raw === 'raw') {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && AGG_OPTIONS.includes(n) ? n : null;
};

const readViewPref = (): ViewMode => {
  if (typeof window === 'undefined') {
    return 'both';
  }
  const raw = window.localStorage.getItem(VIEW_KEY);
  return raw === 'bids' || raw === 'asks' ? raw : 'both';
};

// Click on a sell row → user wants to buy at the asking price.
// Click on a buy row  → user wants to sell into that bid.
// Mirrors TradingView / Binance behavior: the amount is the cumulative
// size from the touch through the clicked level, capped at the balance
// that would fund the order (quote for a buy, base for a sell) when the
// wallet has reported one.
const prefillFromBookRow = (rows: Trace[], price: string, isSell: boolean) => {
  const idx = rows.findIndex(r => r.price === price);
  // Sell rows render worst-first, so the touch is the last row; buy rows
  // render best-first, so the touch is the first row.
  let levels: Trace[] = [];
  if (idx >= 0) {
    levels = isSell ? rows.slice(idx) : rows.slice(0, idx + 1);
  }
  const cumBase = levels.reduce((sum, r) => sum + pnum(r.amount).toNumber(), 0);

  const form = tradeFormStore.limitForm;
  tradeFormStore.setWhichForm('Limit');
  form.setDirection(isSell ? 'buy' : 'sell');
  form.setPriceInput(price);
  if (!(cumBase > 0)) {
    return;
  }

  if (isSell) {
    const quoteBalance = form.quoteAsset?.balance;
    const limitPrice = pnum(price).toNumber();
    if (quoteBalance !== undefined && cumBase * limitPrice > quoteBalance) {
      form.setQuoteInput(quoteBalance.toString());
    } else {
      form.setBaseInput(cumBase.toString());
    }
  } else {
    const baseBalance = form.baseAsset?.balance;
    form.setBaseInput(
      (baseBalance !== undefined ? Math.min(cumBase, baseBalance) : cumBase).toString(),
    );
  }
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
      const r = rows[i];
      if (!r) {
        continue;
      }
      running += pnum(r.total).toNumber();
      out[i] = { ...r, total: running.toString() };
    }
  } else {
    for (const [i, r] of rows.entries()) {
      running += pnum(r.total).toNumber();
      out[i] = { ...r, total: running.toString() };
    }
  }
  return out;
};

export const RouteBook = observer(() => {
  const [cumulative, setCumulative] = useState(false);
  const [agg, setAgg] = useState<AggPct>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  // Levels around the touch, bucketed server-side at the Agg width, paged
  // outward on demand. (It used to be a 100-row full-book simulate per
  // block, bucketed here.)
  const {
    data: book,
    isLoading,
    error: bookErr,
    loadMore,
    isFetchingMore,
  } = useBookV2({ stepPct: agg, levels: LEVELS_PER_PAGE });

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

  const pair = usePathSymbols();

  // Bucket width the server actually used (0 = raw). Rows arrive already
  // aggregated, bids best-first and asks best-LAST (v1's order).
  const bucketSize = book?.step ?? 0;
  const bucketedSell = useMemo<Trace[]>(() => book?.asks ?? [], [book]);
  const bucketedBuy = useMemo<Trace[]>(() => book?.bids ?? [], [book]);

  const baseCap = viewMode === 'both' ? CAP_PER_SIDE : CAP_ONE_SIDE;
  const [sellCap, setSellCap] = useState(baseCap);
  const [buyCap, setBuyCap] = useState(baseCap);
  // Back to the default depth whenever what the ladder shows changes.
  useEffect(() => {
    setSellCap(baseCap);
    setBuyCap(baseCap);
  }, [baseCap, agg, pair.baseSymbol, pair.quoteSymbol]);

  // Cap the visible rows so the panel always fits. `sellRows` needs the
  // rows CLOSEST to the spread — those sit at the END of a DESC-sorted
  // list (lowest ask is last). `buyRows` needs those closest to spread
  // at the TOP, which is the START of a DESC-sorted list (highest bid).
  const sellDisplay = useMemo<Trace[]>(() => {
    if (viewMode === 'bids') {
      return [];
    }
    return bucketedSell.slice(-sellCap);
  }, [bucketedSell, viewMode, sellCap]);
  const buyDisplay = useMemo<Trace[]>(() => {
    if (viewMode === 'asks') {
      return [];
    }
    return bucketedBuy.slice(0, buyCap);
  }, [bucketedBuy, viewMode, buyCap]);

  // "Load more" at the outer end of a side: show rows already loaded
  // first, and fetch the next page (both sides advance together) when the
  // grown cap runs past what is loaded.
  const canMoreSell = viewMode !== 'bids' && (bucketedSell.length > sellCap || !!book?.hasMoreAsks);
  const canMoreBuy = viewMode !== 'asks' && (bucketedBuy.length > buyCap || !!book?.hasMoreBids);
  const moreSell = () => {
    const next = sellCap + LOAD_MORE_ROWS;
    setSellCap(next);
    if (next > bucketedSell.length && book?.hasMoreAsks) {
      loadMore();
    }
  };
  const moreBuy = () => {
    const next = buyCap + LOAD_MORE_ROWS;
    setBuyCap(next);
    if (next > bucketedBuy.length && book?.hasMoreBids) {
      loadMore();
    }
  };

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
  // Memoize on the row arrays — useBookV2 polls every block (~5s), so on
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

  // Simulate the current draft order against the loaded levels. They are
  // already bucketed server-side, so the fill keys are the rendered row
  // prices directly (a bucket's inventory is the sum of its positions).
  //
  // mobx tracking note: reads MUST happen in the render body — an observed
  // read inside a `useMemo` callback that skips because its deps are equal
  // never registers with mobx, so the store observer drops the dep and the
  // fill highlight only updates when the book changes (once per block).
  // Pull the values out here so mobx sees them on every render, then feed
  // them to the memo as explicit deps.
  const whichForm = tradeFormStore.whichForm;
  const marketDirection = tradeFormStore.marketForm.direction;
  const marketBaseInput = tradeFormStore.marketForm.baseInputAmount;
  const limitPriceInput = tradeFormStore.limitForm.priceInput;
  const fillByRenderedPrice = useMemo<Map<string, number>>(() => {
    const none = new Map<string, number>();
    if (whichForm !== 'Market' || !bucketedBuy.length || !bucketedSell.length) {
      return none;
    }
    if (!marketBaseInput || marketBaseInput <= 0) {
      return none;
    }
    return (
      simulateMarketBase(marketDirection, marketBaseInput, bucketedBuy, bucketedSell)?.fills ?? none
    );
  }, [bucketedBuy, bucketedSell, whichForm, marketDirection, marketBaseInput]);

  // Limit form: highlight the row (bucket) the resting price sits in, keyed
  // exactly as the server buckets that side (bids floor, asks ceil).
  // Same mobx-in-useMemo hazard as above — reads happen in the render body
  // so the observer registers them every render.
  const limitFillPrice = useMemo<{ sell: string; buy: string } | undefined>(() => {
    if (whichForm !== 'Limit') {
      return undefined;
    }
    const p = limitPriceInput ? Number(limitPriceInput) : NaN;
    if (!Number.isFinite(p) || p <= 0) {
      return undefined;
    }
    return {
      sell: levelPriceString(bucketPrice(p, bucketSize, 'ask')),
      buy: levelPriceString(bucketPrice(p, bucketSize, 'bid')),
    };
  }, [bucketSize, whichForm, limitPriceInput]);

  // The spread reads the raw touch, not the (conservatively widened)
  // bucketed rows.
  const touchSell = useMemo<Trace[]>(
    () =>
      book?.bestAsk !== undefined
        ? [{ price: levelPriceString(book.bestAsk), amount: '0', total: '0', hops: [] }]
        : [],
    [book?.bestAsk],
  );
  const touchBuy = useMemo<Trace[]>(
    () =>
      book?.bestBid !== undefined
        ? [{ price: levelPriceString(book.bestBid), amount: '0', total: '0', hops: [] }]
        : [],
    [book?.bestBid],
  );

  // Stable click handlers — without useCallback these would be fresh
  // function references on every render, busting any future memo() on
  // <TradeRow>. The handlers don't depend on any state inside the
  // component, so empty deps are safe.
  // Rows live in a ref so the click handlers stay referentially stable and
  // TradeRow's memo doesn't re-render every row on each book update.
  const rowsRef = useRef({ sell: sellRows, buy: buyRows });
  rowsRef.current = { sell: sellRows, buy: buyRows };
  const onSellClick = useCallback(
    (price: string) => prefillFromBookRow(rowsRef.current.sell, price, true),
    [],
  );
  const onBuyClick = useCallback(
    (price: string) => prefillFromBookRow(rowsRef.current.buy, price, false),
    [],
  );

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
    if (next !== undefined) {
      chooseAgg(next);
    }
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
        <span className='min-w-[36px] rounded-sm bg-other-tonal-fill5 px-1.5 py-0.5 text-center text-text-primary tabular-nums'>
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
            title={VIEW_TITLE[v]}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );

  if (isLoading || !book) {
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
  // One-sided book (a fresh pair with only bids or only asks) has no
  // spread to compute, so SpreadRow renders null and the ladder
  // collapses to a lonely one-row panel that reads as "broken". Track
  // whether we have a real two-sided book so we can render an empty-
  // side hint in place of the missing SpreadRow instead.
  const bothSidesPresent = sellRows.length > 0 && buyRows.length > 0;

  // Grid-row bookkeeping for the DepthCurve SVGs. Row 1 = header, then
  // the asks' "Load more" row when shown; sells start after that and take
  // n_sells rows; the spread row or its
  // empty-side placeholder then eats one row (when the layout shows
  // both sides); buys follow.
  const sellGridStart = 2 + (canMoreSell ? 1 : 0);
  const buyGridStart = sellGridStart + sellRows.length + (showSpread ? 1 : 0);
  let emptySide: 'buy' | 'sell' | null = null;
  if (showSpread && !bothSidesPresent) {
    // Both sides empty reads as "no bids"; only asks missing reads as "no asks".
    emptySide = sellRows.length === 0 && buyRows.length > 0 ? 'sell' : 'buy';
  }
  const emptyCopy = emptySideCopy(emptySide, pair.baseSymbol, pair.quoteSymbol);

  return (
    <>
      {controls}
      <div className='relative mt-2 grid w-full auto-rows-[32px] grid-cols-[1fr_1fr_1fr_1fr] items-center gap-x-2'>
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

        {canMoreSell && <LoadMoreRow side='sell' onClick={moreSell} loading={isFetchingMore} />}

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
              (limitFillPrice?.sell === trace.price ? 1 : undefined)
            }
            depthBar={false}
          />
        ))}

        {showSpread &&
          (bothSidesPresent ? (
            <SpreadRow sellOrders={touchSell} buyOrders={touchBuy} />
          ) : (
            <div
              className='col-span-4 flex h-full items-center justify-center px-3 py-3 text-xs text-text-secondary'
              title={emptyCopy.title}
            >
              {emptyCopy.text}
            </div>
          ))}

        {buyRows.map((trace, idx) => (
          <TradeRow
            key={`buy-${idx}`}
            trace={trace}
            isSell={false}
            relativeSize={buyRelativeSizes.get(trace.price) ?? 0}
            onClick={onBuyClick}
            fillFraction={
              fillByRenderedPrice.get(trace.price) ??
              (limitFillPrice?.buy === trace.price ? 1 : undefined)
            }
            depthBar={false}
          />
        ))}

        {canMoreBuy && <LoadMoreRow side='buy' onClick={moreBuy} loading={isFetchingMore} />}
      </div>
    </>
  );
});

const LoadMoreRow = ({
  side,
  onClick,
  loading,
}: {
  side: 'buy' | 'sell';
  onClick: () => void;
  loading: boolean;
}) => (
  <button
    type='button'
    onClick={onClick}
    disabled={loading}
    className='col-span-4 flex h-full items-center justify-center text-[10px] text-text-secondary transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-60'
    title={
      side === 'sell' ? 'Show asks further from the price' : 'Show bids further from the price'
    }
  >
    {loading ? 'Loading…' : `Load more ${side === 'sell' ? 'asks' : 'bids'}`}
  </button>
);

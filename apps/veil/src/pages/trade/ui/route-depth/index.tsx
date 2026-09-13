import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { pnum } from '@penumbra-zone/types/pnum';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { useBook } from '../../api/book';
import { usePathSymbols } from '../../model/use-path';
import { tradeFormStore } from '../order-form/store/OrderFormStore';
import { buildDepthData } from './depth-data';
import { formatDepthPrice, useDepthChart, type DepthHover } from './use-depth-chart';

const ZOOM_KEY = 'veil-route-depth-zoom-pct';
// `null` means "all levels" — no filter. Percent values are half-widths
// around mid (±X%).
const ZOOM_OPTIONS: readonly (number | null)[] = [0.5, 2, 10, null];
const DEFAULT_ZOOM: number | null = 2;
const ZOOM_LABEL = (v: number | null) => (v === null ? 'All' : `±${v}%`);

const formatVolume = (v: number): string => {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  if (v >= 1) return v.toFixed(4);
  return v.toPrecision(4);
};

// Click on the bid side → user wants to SELL at that bid (mirrors route-book).
// Click on the ask side → user wants to BUY at that ask.
const prefillFromDepthClick = (price: string, side: 'bid' | 'ask') => {
  tradeFormStore.setWhichForm('Limit');
  tradeFormStore.limitForm.setDirection(side === 'bid' ? 'sell' : 'buy');
  tradeFormStore.limitForm.setPriceInput(price);
};

export const RouteDepth = observer(() => {
  // Fetch a deeper book than the route-book default so a wide zoom (All /
  // ±10%) still has plausible tails to draw.
  const { data, isLoading, error } = useBook({ traceLimit: 100 });
  const { baseSymbol, quoteSymbol } = usePathSymbols();
  const [zoomPct, setZoomPct] = useState<number | null>(DEFAULT_ZOOM);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ZOOM_KEY);
      if (raw === 'all') setZoomPct(null);
      else if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && ZOOM_OPTIONS.includes(n)) setZoomPct(n);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const chooseZoom = useCallback((v: number | null) => {
    setZoomPct(v);
    try {
      window.localStorage.setItem(ZOOM_KEY, v === null ? 'all' : String(v));
    } catch {
      // ignore storage errors
    }
  }, []);

  const depth = useMemo(() => {
    if (!data?.multiHops) return undefined;
    const { buy, sell } = data.multiHops;
    if (zoomPct === null) return buildDepthData(buy, sell);
    // Filter around mid by ±zoomPct% before we build the chart series so
    // the visible depth curve fits the requested window. Mid is derived
    // from the raw traces (highest bid + lowest ask) / 2 — same rule
    // buildDepthData uses internally.
    let highestBid = 0;
    let lowestAsk = Infinity;
    for (const t of buy) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > highestBid) highestBid = p;
    }
    for (const t of sell) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > 0 && p < lowestAsk) lowestAsk = p;
    }
    if (!Number.isFinite(highestBid) || !Number.isFinite(lowestAsk) || highestBid <= 0) {
      return buildDepthData(buy, sell);
    }
    const mid = (highestBid + lowestAsk) / 2;
    const halfWidth = mid * (zoomPct / 100);
    const lo = mid - halfWidth;
    const hi = mid + halfWidth;
    const inRange = (priceStr: string) => {
      const p = pnum(priceStr).toNumber();
      return Number.isFinite(p) && p >= lo && p <= hi;
    };
    const filteredBuy = buy.filter(t => inRange(t.price));
    const filteredSell = sell.filter(t => inRange(t.price));
    // If the filter empties one side (thin book) fall back to full data
    // so the chart at least renders something.
    if (!filteredBuy.length || !filteredSell.length) return buildDepthData(buy, sell);
    return buildDepthData(filteredBuy, filteredSell);
  }, [data, zoomPct]);

  const [hover, setHover] = useState<DepthHover | null>(null);

  const handleClick = useCallback((price: number, side: 'bid' | 'ask') => {
    prefillFromDepthClick(formatDepthPrice(price), side);
  }, []);

  const { containerRef, setData } = useDepthChart(setHover, handleClick);

  useEffect(() => {
    setData(depth);
  }, [depth, setData]);

  if (error) {
    return (
      <div className='flex h-full w-full items-center justify-center p-4'>
        <BlockchainError direction='column' />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <Loader2 className='size-6 animate-spin text-text-secondary' />
      </div>
    );
  }

  if (!depth) {
    return (
      <div className='flex h-full w-full items-center justify-center p-4'>
        <Text small color='text.secondary'>
          Not enough liquidity to build a depth chart
        </Text>
      </div>
    );
  }

  return (
    <div className='relative flex h-full min-h-0 w-full flex-col'>
      <div className='flex items-center justify-between gap-2 border-b border-b-other-tonal-stroke px-4 py-2 text-xs text-text-secondary'>
        <span>
          Mid:{' '}
          <span className='text-text-primary'>{formatDepthPrice(depth.mid)}</span>{' '}
          {quoteSymbol}/{baseSymbol}
        </span>
        {/* Zoom stepper — prev / current / next along ±0.5% → All. */}
        {(() => {
          const idx = ZOOM_OPTIONS.indexOf(zoomPct);
          const step = (delta: number) => {
            const next = ZOOM_OPTIONS[Math.max(0, Math.min(ZOOM_OPTIONS.length - 1, idx + delta))];
            if (next !== undefined) chooseZoom(next);
          };
          return (
            <div className='flex items-center gap-1'>
              <span className='mr-0.5'>Zoom</span>
              <button
                type='button'
                onClick={() => step(-1)}
                disabled={idx <= 0}
                className='flex h-5 w-5 items-center justify-center rounded-sm bg-other-tonal-fill5 transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-other-tonal-fill5'
                title='Zoom in'
              >
                <ChevronLeft className='h-3 w-3' />
              </button>
              <span className='min-w-[36px] rounded-sm bg-other-tonal-fill5 px-1.5 py-0.5 text-center text-[10px] leading-none tabular-nums text-text-primary'>
                {ZOOM_LABEL(zoomPct)}
              </span>
              <button
                type='button'
                onClick={() => step(1)}
                disabled={idx >= ZOOM_OPTIONS.length - 1}
                className='flex h-5 w-5 items-center justify-center rounded-sm bg-other-tonal-fill5 transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-other-tonal-fill5'
                title='Zoom out'
              >
                <ChevronRight className='h-3 w-3' />
              </button>
            </div>
          );
        })()}
      </div>

      <div className='relative flex-1'>
        <div className='absolute inset-0' ref={containerRef} />
        {hover && <DepthTooltip hover={hover} quoteSymbol={quoteSymbol} mid={depth.mid} />}
      </div>
    </div>
  );
});

const DepthTooltip = ({
  hover,
  quoteSymbol,
  mid,
}: {
  hover: DepthHover;
  quoteSymbol: string;
  mid: number;
}) => {
  const isBid = hover.side === 'bid';
  const value = isBid ? hover.bidValue : hover.askValue;
  // Position the tooltip so it stays inside the chart bounds.
  const offsetX = hover.x > 200 ? -180 : 12;
  const style = {
    left: `${hover.x + offsetX}px`,
    top: `${Math.max(8, hover.y - 56)}px`,
  };
  const pctFromMid = mid > 0 ? ((hover.price - mid) / mid) * 100 : 0;
  return (
    <div
      className='pointer-events-none absolute z-10 rounded-sm border border-other-tonal-stroke bg-other-tonal-fill5 px-3 py-2 text-xs shadow-md backdrop-blur'
      style={style}
    >
      <div className={isBid ? 'text-success-light' : 'text-destructive-light'}>
        {isBid ? 'Bid' : 'Ask'} side
      </div>
      <div className='mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums'>
        <span className='text-text-secondary'>Price</span>
        <span className='text-text-primary'>{formatDepthPrice(hover.price)}</span>
        <span className='text-text-secondary'>Depth</span>
        <span className='text-text-primary'>
          {value !== undefined ? `${formatVolume(value)} ${quoteSymbol}` : '—'}
        </span>
        <span className='text-text-secondary'>From mid</span>
        <span className='text-text-primary'>
          {pctFromMid >= 0 ? '+' : ''}
          {pctFromMid.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const ZOOM_OPTIONS: readonly (number | null)[] = [0.5, 2, 10, 25, null];
const ZOOM_OPTIONS_MIN = 0.5;
const DEFAULT_ZOOM: number | null = 10;
const ZOOM_LABEL = (v: number | null) => {
  if (v === null) {
    return 'All';
  }
  // Wheel/pinch zoom can land on non-stepper values — trim to a sane
  // number of decimals for display (whole numbers stay bare).
  const rounded = v >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
  return `±${rounded}%`;
};

// Wheel/pinch zoom tuning. `null` (All) is treated as this baseline pct for
// the purposes of scaling a step relative to it.
const ZOOM_ALL_BASELINE = 50;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 50;
const ZOOM_STEP_FACTOR = 0.15;
// Minimum fractional change in pinch distance before we register a step —
// keeps small jitter from firing spurious zoom steps.
const PINCH_THRESHOLD = 0.02;

const formatVolume = (v: number): string => {
  if (!Number.isFinite(v)) {
    return '-';
  }
  if (v >= 1_000_000) {
    return `${(v / 1_000_000).toFixed(2)}M`;
  }
  if (v >= 1_000) {
    return `${(v / 1_000).toFixed(2)}K`;
  }
  if (v >= 1) {
    return v.toFixed(4);
  }
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
      if (raw === 'all') {
        setZoomPct(null);
      } else if (raw) {
        const n = Number(raw);
        // Accept any finite pct here, not just the fixed stepper values —
        // wheel/pinch zoom can persist an in-between pct (e.g. ±3.4%).
        if (Number.isFinite(n) && n > 0) {
          setZoomPct(n);
        }
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

  // Kept in sync with zoomPct so wheel/touch handlers (attached once, outside
  // React's render cycle) always read the latest value without needing to be
  // re-subscribed on every zoom change.
  const zoomPctRef = useRef(zoomPct);
  useEffect(() => {
    zoomPctRef.current = zoomPct;
  }, [zoomPct]);

  // direction > 0 means "zoom out" (widen the ±% window), direction < 0
  // means "zoom in" (narrow it). Exponential step: multiply the current
  // (or, for "All", the assumed baseline) pct by (1 ± 0.15) per tick.
  const applyZoomStep = useCallback(
    (direction: number) => {
      if (direction === 0) {
        return;
      }
      const current = zoomPctRef.current;
      const effective = current ?? ZOOM_ALL_BASELINE;
      if (direction > 0) {
        // Already at "All" — nothing wider to go to.
        if (current === null) {
          return;
        }
        // Already resting at the widest numeric step — the next wheel-out
        // tick goes to "All", not past it.
        if (effective >= ZOOM_MAX) {
          chooseZoom(null);
          return;
        }
        const next = effective * (1 + ZOOM_STEP_FACTOR);
        chooseZoom(Math.min(ZOOM_MAX, next));
      } else {
        const next = Math.max(ZOOM_MIN, effective * (1 - ZOOM_STEP_FACTOR));
        chooseZoom(next);
      }
    },
    [chooseZoom],
  );

  // Wheel: mouse wheel zoom on the chart container. Passive: false so
  // preventDefault actually stops page scroll.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) {
        return;
      }
      applyZoomStep(e.deltaY > 0 ? 1 : -1);
    },
    [applyZoomStep],
  );

  // Pinch-to-zoom on touch. Only active while exactly two fingers are down —
  // single-touch scroll/pan is left alone.
  const pinchDistanceRef = useRef<number | null>(null);

  const getTouchDistance = (touches: TouchList): number => {
    const a = touches.item(0);
    const b = touches.item(1);
    if (!a || !b) {
      return 0;
    }
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      pinchDistanceRef.current = getTouchDistance(e.touches);
    } else {
      pinchDistanceRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchDistanceRef.current === null) {
        return;
      }
      e.preventDefault();
      const prevDistance = pinchDistanceRef.current;
      const nextDistance = getTouchDistance(e.touches);
      if (prevDistance <= 0) {
        pinchDistanceRef.current = nextDistance;
        return;
      }
      const ratio = nextDistance / prevDistance;
      if (Math.abs(ratio - 1) < PINCH_THRESHOLD) {
        return;
      }
      // Fingers spreading apart (ratio > 1) → zoom in; pinching together
      // (ratio < 1) → zoom out.
      applyZoomStep(ratio > 1 ? -1 : 1);
      pinchDistanceRef.current = nextDistance;
    },
    [applyZoomStep],
  );

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) {
      pinchDistanceRef.current = null;
    }
  }, []);

  const depth = useMemo(() => {
    if (!data?.multiHops) {
      return undefined;
    }
    const { buy, sell } = data.multiHops;
    if (zoomPct === null) {
      return buildDepthData(buy, sell);
    }
    // Filter around mid by ±zoomPct% before we build the chart series so
    // the visible depth curve fits the requested window. Mid is derived
    // from the raw traces (highest bid + lowest ask) / 2 — same rule
    // buildDepthData uses internally.
    let highestBid = 0;
    let lowestAsk = Infinity;
    for (const t of buy) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > highestBid) {
        highestBid = p;
      }
    }
    for (const t of sell) {
      const p = pnum(t.price).toNumber();
      if (Number.isFinite(p) && p > 0 && p < lowestAsk) {
        lowestAsk = p;
      }
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
    if (!filteredBuy.length || !filteredSell.length) {
      return buildDepthData(buy, sell);
    }
    return buildDepthData(filteredBuy, filteredSell);
  }, [data, zoomPct]);

  const [hover, setHover] = useState<DepthHover | null>(null);

  const handleClick = useCallback((price: number, side: 'bid' | 'ask') => {
    prefillFromDepthClick(formatDepthPrice(price), side);
  }, []);

  const { containerRef, setData } = useDepthChart(setHover, handleClick);

  // Attach the wheel/pinch listeners directly to the chart container. This
  // is a plain callback ref (not a useEffect keyed on a DOM node in state)
  // so it fires exactly once per mount/unmount of the container element,
  // matching how `containerRef` itself is wired in useDepthChart. We hold
  // the node ourselves (rather than trusting the `null` callback to only
  // ever follow the node it was just given) so React StrictMode's
  // mount → unmount → remount in dev can't leave a stale listener set
  // attached to an earlier node.
  const wheelZoomNodeRef = useRef<HTMLDivElement | null>(null);

  const setWheelZoomRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef(node);
      const prev = wheelZoomNodeRef.current;
      if (prev) {
        prev.removeEventListener('wheel', handleWheel);
        prev.removeEventListener('touchstart', handleTouchStart);
        prev.removeEventListener('touchmove', handleTouchMove);
        prev.removeEventListener('touchend', handleTouchEnd);
        prev.removeEventListener('touchcancel', handleTouchEnd);
      }
      wheelZoomNodeRef.current = node;
      if (!node) {
        return;
      }
      // Only `wheel` and `touchmove` call preventDefault, so only those two
      // need passive: false.
      node.addEventListener('wheel', handleWheel, { passive: false });
      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd, { passive: true });
      node.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    },
    [containerRef, handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd],
  );

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
          Mid: <span className='text-text-primary'>{formatDepthPrice(depth.mid)}</span>{' '}
          {quoteSymbol}/{baseSymbol}
        </span>
        {/* Zoom stepper — prev / current / next along ±0.5% → All. */}
        {(() => {
          // Wheel/pinch zoom can land zoomPct on a value between the fixed
          // stepper options (e.g. ±3.4%). Only highlight a pill on an exact
          // match, but still let the prev/next buttons find their way back
          // onto the stepper scale from wherever the wheel left off.
          const exactIdx = ZOOM_OPTIONS.indexOf(zoomPct);
          const nearestIdx = (() => {
            if (exactIdx !== -1) {
              return exactIdx;
            }
            if (zoomPct === null) {
              return ZOOM_OPTIONS.length - 1;
            }
            // Find the option numerically closest to the current pct.
            let best = 0;
            let bestDiff = Infinity;
            ZOOM_OPTIONS.forEach((opt, i) => {
              const diff = opt === null ? Infinity : Math.abs(opt - zoomPct);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = i;
              }
            });
            return best;
          })();
          const step = (delta: number) => {
            const idx = Math.max(0, Math.min(ZOOM_OPTIONS.length - 1, nearestIdx + delta));
            const next = ZOOM_OPTIONS[idx];
            if (next !== undefined) {
              chooseZoom(next);
            }
          };
          return (
            <div className='flex items-center gap-1'>
              <span className='mr-0.5'>Zoom</span>
              <button
                type='button'
                onClick={() => step(-1)}
                disabled={zoomPct !== null && zoomPct <= ZOOM_OPTIONS_MIN}
                className='flex h-5 w-5 items-center justify-center rounded-sm bg-other-tonal-fill5 transition-colors hover:bg-action-hover-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-other-tonal-fill5'
                title='Zoom in'
              >
                <ChevronLeft className='h-3 w-3' />
              </button>
              <span className='min-w-[36px] rounded-sm bg-other-tonal-fill5 px-1.5 py-0.5 text-center text-[10px] leading-none text-text-primary tabular-nums'>
                {ZOOM_LABEL(zoomPct)}
              </span>
              <button
                type='button'
                onClick={() => step(1)}
                disabled={
                  nearestIdx >= ZOOM_OPTIONS.length - 1 && exactIdx === ZOOM_OPTIONS.length - 1
                }
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
        <div className='absolute inset-0' ref={setWheelZoomRef} />
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

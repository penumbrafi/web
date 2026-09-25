import { useCallback, useEffect, useRef, useState } from 'react';
import { tradeFormStore } from '../order-form/store/OrderFormStore';
import { type TickDirection, useTickDirection } from '../../model/use-tick-direction';

// theme.ts is a typing stub — most fields resolve to ''.
// Use the actual hex values from theme.css so the line and label render.
const LABEL_TEXT = '#0d0d0d';
const NEUTRAL_COLOR = '#f49c43'; // primary.light — first paint, no direction signal
const UP_COLOR = '#55d383'; // success.light — last tick was up
const DOWN_COLOR = '#f17878'; // destructive.light — last tick was down
const DIRECTION_COLOR: Record<TickDirection, string> = {
  up: UP_COLOR,
  down: DOWN_COLOR,
  flat: NEUTRAL_COLOR,
};
const DIRECTION_ARROW: Record<TickDirection, string> = { up: '▲', down: '▼', flat: '·' };

interface MidPriceOverlayProps {
  /** Mid-price from the order book; undefined while the book is loading. */
  marketPrice: number | undefined;
  /** Spread as a percentage of mid; surfaced inline next to the price so the
   *  trader sees liquidity tightness with one glance. */
  spreadPercentage: number | undefined;
  yAtPrice: (price: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  quoteSymbol: string;
}

const formatPrice = (p: number): string => {
  if (p >= 1) {return p.toFixed(4);}
  if (p >= 0.01) {return p.toFixed(5);}
  if (p >= 0.0001) {return p.toFixed(6);}
  return p.toPrecision(4);
};

/**
 * Renders the live mid-price as a thin dotted horizontal line over the candle
 * canvas, with a small label on the right edge. The label flips green/red
 * with an arrow whenever the mid moves vs. the previous tick — instant
 * directional read, like Binance/Bybit's "live price" tag. Implemented as a
 * DOM overlay (not a lightweight-charts price line) so the render path can't
 * take down the chart if the API changes or the line ref desyncs across
 * rerenders.
 *
 * The label is clickable: pre-fills the limit form with the current mid
 * price, mirroring the route-book SpreadRow's existing 'click to use mid'
 * behaviour so the same gesture works wherever the mid is visible.
 */
export const MidPriceOverlay = ({
  marketPrice,
  spreadPercentage,
  yAtPrice,
  subscribeRedraw,
  quoteSymbol,
}: MidPriceOverlayProps) => {
  const [y, setY] = useState<number | undefined>(undefined);
  // Direction logic now lives in useTickDirection so this overlay, the
  // Summary 'Mid price' card and the document-title ticker all share one
  // implementation.
  const direction = useTickDirection(marketPrice);

  // The live mid goes through a ref so the redraw subscription below is
  // set up once per chart, not torn down and rebuilt (ResizeObserver +
  // chart listeners) every ~6s block tick.
  const priceRef = useRef(marketPrice);
  const recompute = useCallback(() => {
    const p = priceRef.current;
    if (p === undefined || !Number.isFinite(p) || p <= 0) {
      setY(undefined);
      return;
    }
    setY(yAtPrice(p));
  }, [yAtPrice]);

  useEffect(() => {
    priceRef.current = marketPrice;
    recompute();
  }, [marketPrice, recompute]);

  useEffect(() => subscribeRedraw(recompute), [subscribeRedraw, recompute]);

  if (y === undefined || marketPrice === undefined) {return null;}

  const color = DIRECTION_COLOR[direction];
  const arrow = DIRECTION_ARROW[direction];
  const priceStr = formatPrice(marketPrice);

  const useMidAsLimit = () => {
    tradeFormStore.setWhichForm('Limit');
    tradeFormStore.limitForm.setPriceInput(priceStr);
  };

  // Tight spreads (<1%) read better with two decimals; wider books would
  // round to "0%" otherwise — keep one decimal for those.
  const spreadStr =
    spreadPercentage !== undefined && Number.isFinite(spreadPercentage)
      ? `${spreadPercentage.toFixed(spreadPercentage < 1 ? 2 : 1)}%`
      : null;

  return (
    <div
      aria-label='Mid price'
      // The wrapper is pointer-events-none so the dotted line doesn't
      // swallow chart pans/clicks. The clickable label below opts back
      // into pointer events.
      className='pointer-events-none absolute right-0 left-0 z-[6]'
      style={{ top: y - 1, height: 2 }}
    >
      <div
        className='absolute left-0'
        style={{
          right: 56,
          top: 0,
          height: 1,
          borderTop: `1px dotted ${color}`,
          opacity: 0.85,
        }}
      />
      <button
        type='button'
        onClick={useMidAsLimit}
        title={
          spreadStr
            ? `Click to set limit price to mid (${priceStr}) · spread ${spreadStr}`
            : `Click to set limit price to mid (${priceStr})`
        }
        className='pointer-events-auto absolute -translate-y-1/2 cursor-pointer rounded-sm px-1 py-px text-[10px] leading-tight transition-opacity hover:opacity-90'
        style={{
          right: 0,
          top: 1,
          background: color,
          color: LABEL_TEXT,
        }}
      >
        {arrow} {priceStr} {quoteSymbol}
        {spreadStr && (
          <span className='ml-1 opacity-75' style={{ fontVariantNumeric: 'tabular-nums' }}>
            · {spreadStr}
          </span>
        )}
      </button>
    </div>
  );
};

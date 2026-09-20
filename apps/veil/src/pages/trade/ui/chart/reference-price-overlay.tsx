'use client';

import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tradeFormStore } from '../order-form/store/OrderFormStore';
import { useReferencePrice } from '@/pages/trade/model/useReferencePrice';

interface Props {
  yAtPrice: (price: number) => number | undefined;
  priceAtY: (y: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  quoteSymbol: string;
}

// A separate colour from the live-mid line so the two are visually
// distinct. Blue = "your intent", orange = "the market".
const LINE_COLOR = 'rgba(96, 165, 250, 0.9)'; // tailwind blue-400
const LABEL_BG = 'rgba(96, 165, 250, 0.95)';
const LABEL_FG = '#0d0d0d';

/**
 * Draggable + clickable reference-price line on the chart. Renders only
 * while the user is on LP or RangeLP (the only forms that consume
 * `effectiveMarketPrice`).
 *
 * - Grab the small square handle on the right and drag up/down → live
 *   `priceAtY` at the pointer sets `LPFormStore.userReferencePriceInput`.
 *   Cheap: writes the store on every pointermove, mobx batches +
 *   `effectiveMarketPrice` is a computed so the ladder / overlays /
 *   validation all react in the same frame.
 * - Click the label pill on the left → snap to the suggested reference
 *   (CoinGecko or peg) from `useReferencePrice`. If no suggestion is
 *   available (unknown pair) the label just says "set" and the click is
 *   inert — the drag still works.
 *
 * DOM overlay (not a lightweight-charts price line) so pointer capture
 * and mobx re-render live inside React, and a lightweight-charts API
 * shift can't break the drag.
 */
export const ReferencePriceOverlay = observer(function ReferencePriceOverlay({
  yAtPrice,
  priceAtY,
  subscribeRedraw,
  quoteSymbol,
}: Props) {
  const whichForm = tradeFormStore.whichForm;
  const isLpLike = whichForm === 'LP' || whichForm === 'RangeLP';

  const lpForm = tradeFormStore.lpForm;
  const refPrice = lpForm.effectiveMarketPrice;

  const baseSym = lpForm.baseAsset?.symbol;
  const quoteSym = lpForm.quoteAsset?.symbol;
  const suggested = useReferencePrice(baseSym, quoteSym);

  // Live pixel position of the line. Recomputed on redraw (Y-rescale,
  // pane resize, mid change) via `subscribeRedraw` + `yAtPrice(refPrice)`.
  // `priceRef` mirrors refPrice so the redraw subscription doesn't tear
  // down/rebuild every time the user drags.
  const [y, setY] = useState<number | undefined>(undefined);
  const priceRef = useRef<number | null>(refPrice);
  const recompute = useCallback(() => {
    const p = priceRef.current;
    if (p === null || !Number.isFinite(p) || p <= 0) {
      setY(undefined);
      return;
    }
    setY(yAtPrice(p));
  }, [yAtPrice]);
  useEffect(() => {
    priceRef.current = refPrice;
    recompute();
  }, [refPrice, recompute]);
  useEffect(() => subscribeRedraw(recompute), [subscribeRedraw, recompute]);

  // Drag: capture the pointer on the handle so movement continues even if
  // it leaves the handle rect. Set userReferencePriceInput to whatever
  // price the pointer's y maps to, formatted at the quote's precision.
  const dragging = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      // Y is relative to the overlay's positioned ancestor (the chart
      // pane). e.clientY - rect.top of the ancestor gives us the pane-
      // local pixel `priceAtY` expects.
      const container = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const price = priceAtY(localY);
      if (price === undefined || !Number.isFinite(price) || price <= 0) return;
      // Match the input field's precision by using the quote asset's
      // exponent — same shape the ReferencePriceInput placeholder uses.
      const exp = lpForm.quoteAsset?.exponent ?? 6;
      const formatted = price.toFixed(Math.min(exp, 8));
      lpForm.setUserReferencePriceInput(formatted);
    },
    [priceAtY, lpForm],
  );
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released by the browser
    }
  }, []);

  // Click on the pill: snap to the suggested price if we have one.
  const onLabelClick = useCallback(() => {
    if (suggested.price === undefined) return;
    const exp = lpForm.quoteAsset?.exponent ?? 6;
    lpForm.setUserReferencePriceInput(suggested.price.toFixed(Math.min(exp, 8)));
  }, [suggested.price, lpForm]);

  if (!isLpLike) return null;
  if (y === undefined || refPrice === null) return null;

  // Style the line differently based on whether the user has explicitly
  // set the reference or is running against the fallback (live mid or
  // range midpoint). Solid dashed = explicit; sparse dotted = fallback.
  const isExplicit = lpForm.userReferencePrice !== null;
  const lineStyle = isExplicit
    ? { borderTop: `1px dashed ${LINE_COLOR}`, opacity: 0.95 }
    : { borderTop: `1px dotted ${LINE_COLOR}`, opacity: 0.55 };

  const suggestedLabel =
    suggested.price !== undefined && suggested.source === 'fixed'
      ? `snap to peg`
      : suggested.price !== undefined
        ? `snap to CoinGecko`
        : null;

  const priceStr = refPrice.toFixed(refPrice >= 1 ? 4 : refPrice >= 0.01 ? 5 : 6);

  return (
    <div
      aria-label='Reference price'
      className='pointer-events-none absolute left-0 right-0 z-[6]'
      style={{ top: y - 1, height: 2 }}
    >
      {/* Dashed / dotted line spanning the pane except the right edge
          where the drag handle sits. */}
      <div
        className='absolute left-0'
        style={{ right: 24, top: 0, height: 1, ...lineStyle }}
      />
      {/* Left-side label pill: shows the current reference price + a
          hint. Click snaps to the suggested source. */}
      <button
        type='button'
        onClick={onLabelClick}
        title={
          suggested.price !== undefined
            ? `Reference price ${priceStr} ${quoteSymbol}. Click to ${suggestedLabel}. Drag the right handle to set manually.`
            : `Reference price ${priceStr} ${quoteSymbol}. Drag the right handle to set manually.`
        }
        className='pointer-events-auto absolute -translate-y-1/2 cursor-pointer rounded-sm px-1 py-px text-[10px] leading-tight transition-opacity hover:opacity-90'
        style={{
          left: 4,
          top: 1,
          background: LABEL_BG,
          color: LABEL_FG,
        }}
      >
        ref {priceStr}
        {suggestedLabel && <span className='ml-1 opacity-75'>· {suggestedLabel}</span>}
      </button>
      {/* Right-side drag handle. Small square with the touch target
          slightly larger than the visual, matching the LP range handles'
          affordance shape. */}
      <div
        role='slider'
        aria-label='Drag to set reference price'
        aria-valuenow={refPrice}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className='pointer-events-auto absolute -translate-y-1/2 cursor-ns-resize touch-none rounded-sm'
        style={{
          right: 60, // clear of the mid-price label at right:0
          top: 1,
          width: 12,
          height: 12,
          background: LABEL_BG,
          border: `1px solid ${LABEL_FG}`,
          boxShadow: '0 0 0 2px rgba(0,0,0,0.35)',
        }}
      />
    </div>
  );
});

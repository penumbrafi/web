'use client';

import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  getPositionWeights,
  LiquidityDistributionShape,
} from '@/shared/math/position';
import { tradeFormStore } from '../order-form/store/OrderFormStore';

// Match the route-book / depth-overlay palette so the preview reads as
// 'these would be your bids and asks' rather than something abstract.
const BUY_COLOR = '#55d383'; // success.light — bids below mid
const SELL_COLOR = '#f17878'; // destructive.light — asks above mid
const RANGE_FILL = 'rgba(186, 77, 20, 0.06)';
const RANGE_EDGE = '#f49c43';

// Vertical hit-strip height (px) centered on each dashed edge. Tall
// enough to grab comfortably with a mouse or touch without covering
// enough band to obscure the rungs below.
const HANDLE_HIT_HEIGHT = 10;

// Throttle commits back to the mobx store during a drag so downstream
// computations (position plans, weights) don't storm on every pointermove.
const COMMIT_THROTTLE_MS = 30;

// Minimum multiplicative gap between lower and upper during drag —
// prevents the two edges from crossing or landing on top of each other.
const MIN_GAP = 1.0001;

interface LpPreviewOverlayProps {
  yAtPrice: (price: number) => number | undefined;
  priceAtY: (y: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
}

interface Rung {
  y: number;
  side: 'buy' | 'sell';
  /** Per-rung quantity in normalized units, used for bar width. */
  qty: number;
}

interface PreviewState {
  yLower: number;
  yUpper: number;
  /** Pixel y of the live chain mid, or undefined if mid is outside the
   *  LP's drawn range (in which case we don't render the marker — it
   *  would land off-band and confuse the read). */
  yMid: number | undefined;
  rungs: Rung[];
}

type DragEdge = 'upper' | 'lower';

/**
 * Live shadow-order overlay for the LP form. Mirrors what
 * rangeLiquidityPositions / simpleLiquidityPositions on the chain side will
 * actually broadcast:
 *
 *   - For each planned position, classify by side: price < mid → buy-side
 *     bid offering quote, price >= mid → sell-side ask offering base.
 *   - Compute per-rung quantity using getPositionWeights × the form's
 *     liquidity inputs, so the bar width reflects the *distribution shape's*
 *     real allocation per slot, not just rung position.
 *   - Render bids in green and asks in red, extending leftward from the
 *     price axis — the same orientation as DepthOverlay's live route-book
 *     bars, so the eye reads them as 'this is the depth I'm about to add'.
 *
 * The dashed top / bottom edges of the range band are also drag handles:
 * pointer-down on either strip → drag vertically → drop commits the new
 * price back to the form store's setters. During drag the strip follows
 * the pointer locally and commits are throttled so mobx-driven downstream
 * recomputes don't storm on every pointermove.
 *
 * Pure DOM overlay over the candle canvas, same plumbing as DepthOverlay
 * and MidPriceOverlay so it can't take the chart down.
 */
export const LpPreviewOverlay = observer(
  ({ yAtPrice, priceAtY, subscribeRedraw }: LpPreviewOverlayProps) => {
    const { whichForm, simpleLPForm, rangeForm, marketPrice: anchorMid } = tradeFormStore;
    const isLp = whichForm === 'SimpleLP' || whichForm === 'RangeLP';

    // Read draft form state — observer() makes the overlay re-render on
    // every form mutation (slider drag, shape toggle, count change, etc).
    let lower: number | undefined;
    let upper: number | undefined;
    let count = 0;
    let shape: LiquidityDistributionShape = LiquidityDistributionShape.FLAT;
    let baseLiq = 0;
    let quoteLiq = 0;
    if (isLp) {
      if (whichForm === 'SimpleLP') {
        lower = simpleLPForm.lowerPriceInput ?? undefined;
        upper = simpleLPForm.upperPriceInput ?? undefined;
        count = simpleLPForm.positions;
        shape = simpleLPForm.liquidityShape;
        baseLiq = parseFloat(simpleLPForm.baseInput) || 0;
        quoteLiq = parseFloat(simpleLPForm.quoteInput) || 0;
      } else {
        lower = rangeForm.lowerPrice;
        upper = rangeForm.upperPrice;
        count = rangeForm.positionCount ?? 0;
        shape = rangeForm._liquidityShape;
        // RangeLP uses a single liquidityTarget split per position; treat
        // both sides as equal allocation since the form doesn't separate.
        const tgt = rangeForm.liquidityTarget ?? 0;
        baseLiq = tgt;
        quoteLiq = tgt;
      }
    }

    const mid = anchorMid;

    const valid =
      isLp &&
      lower !== undefined &&
      upper !== undefined &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      lower > 0 &&
      upper > lower &&
      count > 0 &&
      mid !== undefined &&
      mid > 0;

    const [pos, setPos] = useState<PreviewState | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Drag state. During a drag we ignore store-driven y updates for the
    // edge being dragged and paint from `dragY` instead, so the strip
    // tracks the pointer 1:1 even while the throttled commit lags.
    const [drag, setDrag] = useState<{ edge: DragEdge; y: number } | null>(null);
    const dragRef = useRef<{
      edge: DragEdge;
      pointerId: number;
      lastCommit: number;
      lastPrice: number | undefined;
    } | null>(null);

    useEffect(() => {
      if (!valid) {
        setPos(null);
        return;
      }
      const lo = lower as number;
      const hi = upper as number;
      const m = mid as number;
      const n = count;

      // Mirror simpleLiquidityPositions on the chain side: positions
      // below mid carry quote (bids), positions above carry base (asks),
      // and the per-position weight comes from getPositionWeights against
      // the chosen distribution shape. Walk the same lo + i*step that the
      // plan getter walks so the rungs land on the chain's exact prices.
      const weights = getPositionWeights(n, shape);
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

      const recompute = () => {
        const rungs: Rung[] = [];
        const step = (hi - lo) / n;
        for (let i = 0; i < n; i++) {
          const price = lo + i * step;
          const y = yAtPrice(price);
          if (y === undefined) continue;
          const w = weights[i] ?? 0;
          if (price < m) {
            // bid: offers quote, qty in quote terms
            const qty = (w / totalWeight) * quoteLiq;
            rungs.push({ y, side: 'buy', qty });
          } else {
            // ask: offers base, qty in base terms — convert to quote-
            // equivalent for visual scaling so bid/ask widths share a
            // comparable axis.
            const qty = (w / totalWeight) * baseLiq * price;
            rungs.push({ y, side: 'sell', qty });
          }
        }
        const yLo = yAtPrice(lo);
        const yHi = yAtPrice(hi);
        if (yLo === undefined || yHi === undefined) {
          setPos(null);
          return;
        }
        // Mid marker — only when mid lies within the LP's drawn range,
        // otherwise the line would render off-band and read as if the
        // form were misconfigured. (Out-of-range mids are usually a
        // transient state mid-typing, not a steady configuration.)
        const yMidRaw = yAtPrice(m);
        const inRange = m >= lo && m <= hi;
        setPos({
          yLower: Math.max(yLo, yHi),
          yUpper: Math.min(yLo, yHi),
          yMid: inRange ? yMidRaw : undefined,
          rungs,
        });
      };
      return subscribeRedraw(recompute);
    }, [valid, lower, upper, count, shape, baseLiq, quoteLiq, mid, yAtPrice, subscribeRedraw]);

    if (!pos) return null;

    // Format a numeric price for the form store. SimpleLP takes numbers,
    // RangeLP takes strings — both stores clamp/validate on their own, we
    // just supply a reasonable precision so the input field reads nicely.
    const commitPrice = (edge: DragEdge, price: number) => {
      if (!Number.isFinite(price) || price <= 0) return;
      if (whichForm === 'SimpleLP') {
        // SimpleLP stores raw numbers.
        const rounded = Number(price.toPrecision(6));
        if (edge === 'upper') {
          simpleLPForm.setUpperPriceInput(rounded);
        } else {
          simpleLPForm.setLowerPriceInput(rounded);
        }
      } else if (whichForm === 'RangeLP') {
        // RangeLP stores strings that are parsed on read.
        const asString = Number(price.toPrecision(6)).toString();
        if (edge === 'upper') {
          rangeForm.setUpperPriceInput(asString);
        } else {
          rangeForm.setLowerPriceInput(asString);
        }
      }
    };

    const onPointerDown = (edge: DragEdge) => (ev: React.PointerEvent<HTMLDivElement>) => {
      // Only left mouse / primary touch; ignore right-click, middle-click.
      if (ev.button !== undefined && ev.button !== 0) return;
      const target = ev.currentTarget;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      try {
        target.setPointerCapture(ev.pointerId);
      } catch {
        // setPointerCapture can throw on some browsers when the pointer is
        // already released — non-fatal, drag will just fall back to
        // document-level events which we don't wire up. Best-effort.
      }
      dragRef.current = {
        edge,
        pointerId: ev.pointerId,
        lastCommit: 0,
        lastPrice: undefined,
      };
      setDrag({ edge, y });
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const rawPrice = priceAtY(y);
      if (rawPrice === undefined || !Number.isFinite(rawPrice) || rawPrice <= 0) {
        return;
      }
      // Clamp so upper > lower * MIN_GAP (and vice versa). Uses the
      // currently-committed opposite bound as the anchor.
      let price = rawPrice;
      if (state.edge === 'upper') {
        const lo = lower as number;
        if (price <= lo * MIN_GAP) price = lo * MIN_GAP;
      } else {
        const hi = upper as number;
        if (price >= hi / MIN_GAP) price = hi / MIN_GAP;
      }
      // Re-map clamped price back to a y so the strip visibly stops at
      // the clamp instead of tracking past it.
      const clampedY = yAtPrice(price);
      setDrag({ edge: state.edge, y: clampedY ?? y });

      state.lastPrice = price;
      const now = performance.now();
      if (now - state.lastCommit >= COMMIT_THROTTLE_MS) {
        state.lastCommit = now;
        commitPrice(state.edge, price);
      }
    };

    const onPointerUp = (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch {
        // See onPointerDown — releasePointerCapture can throw if capture
        // was never acquired. Non-fatal; the drag ends either way.
      }
      // Commit whatever the final pointer position mapped to (may not
      // have flushed yet due to throttling).
      if (state.lastPrice !== undefined) {
        commitPrice(state.edge, state.lastPrice);
      }
      dragRef.current = null;
      setDrag(null);
    };

    // Effective edge y — during a drag on this edge we paint from the
    // pointer's live y, not the store-derived one, so the visible strip
    // tracks the cursor 1:1 even when commits are throttled.
    const upperY = drag?.edge === 'upper' ? drag.y : pos.yUpper;
    const lowerY = drag?.edge === 'lower' ? drag.y : pos.yLower;

    // Normalize bar widths against the largest rung so the distribution
    // shape's relative weighting is what the eye reads, not the absolute
    // currency amount (which is captured numerically in the form).
    const maxQty = pos.rungs.reduce((m, r) => Math.max(m, r.qty), 0) || 1;

    return (
      <div
        ref={containerRef}
        aria-label='LP position preview'
        // pointer-events-none on the container so the chart canvas
        // underneath keeps receiving events; individual hit-strips below
        // opt back in with pointer-events-auto.
        className='pointer-events-none absolute inset-0 z-[5]'
      >
        {/* Range band — translucent envelope around all rungs */}
        <div
          className='absolute left-0'
          style={{
            right: 56,
            top: upperY,
            height: Math.max(1, lowerY - upperY),
            background: RANGE_FILL,
            borderTop: `1px dashed ${RANGE_EDGE}`,
            borderBottom: `1px dashed ${RANGE_EDGE}`,
          }}
        />
        {/* Mid-price marker — a faint dashed horizontal across the LP
            band labelling where the live chain mid sits. Makes the
            buy/sell split (green below, red above) explicit instead of
            implicit, and lets the trader see whether their range is
            symmetric around mid or skewed. */}
        {pos.yMid !== undefined && (
          <>
            <div
              className='absolute left-0'
              style={{
                right: 56,
                top: pos.yMid - 0.5,
                height: 1,
                borderTop: '1px dashed rgba(255, 255, 255, 0.45)',
              }}
            />
            <div
              className='absolute rounded-sm bg-base-black/70 px-1 text-[10px] tabular-nums text-text-secondary'
              style={{
                right: 60,
                top: pos.yMid - 7,
                lineHeight: '14px',
                pointerEvents: 'none',
              }}
            >
              Mid
            </div>
          </>
        )}
        {/* Per-position 'shadow' bars: green for bids below mid, red for
            asks above mid. Width proportional to the rung's quote-
            equivalent quantity. Read like a paper-thin DepthOverlay for
            the LP draft. */}
        {pos.rungs.map((r, i) => {
          const widthFrac = r.qty > 0 ? Math.max(0.05, r.qty / maxQty) : 0;
          return (
            <div
              key={i}
              className='absolute'
              style={{
                left: 0,
                top: r.y - 1,
                width: `calc((100% - 56px) * ${widthFrac})`,
                height: 2,
                background: r.side === 'buy' ? BUY_COLOR : SELL_COLOR,
                opacity: 0.7,
              }}
            />
          );
        })}
        {/* Drag handles — invisible hit-strips centered on each dashed
            edge. Wider than the visible line so they're comfortable to
            grab, and pointer-events-auto so the chart's own pan/zoom
            handlers don't swallow the pointerdown. */}
        <div
          role='slider'
          aria-label='Upper price bound'
          aria-valuenow={upper}
          className='pointer-events-auto absolute left-0'
          style={{
            right: 56,
            top: upperY - HANDLE_HIT_HEIGHT / 2,
            height: HANDLE_HIT_HEIGHT,
            cursor: 'row-resize',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown('upper')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div
          role='slider'
          aria-label='Lower price bound'
          aria-valuenow={lower}
          className='pointer-events-auto absolute left-0'
          style={{
            right: 56,
            top: lowerY - HANDLE_HIT_HEIGHT / 2,
            height: HANDLE_HIT_HEIGHT,
            cursor: 'row-resize',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown('lower')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    );
  },
);

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

// Bar-end drag handle width (px) — small square nub at the right edge of
// each rendered rung that lets the user pull the bar longer/shorter.
const BAR_HANDLE_WIDTH = 8;
// Minimum bar width fraction after a shrink drag — a weight of 0 is fine
// but drawing a completely invisible bar makes it impossible to grab
// again.
const MIN_BAR_FRAC = 0.02;
// Same throttle as the edge drag: keep mobx recomputes off the 60Hz
// pointermove path.
const RUNG_COMMIT_THROTTLE_MS = 30;

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
    const { whichForm, lpForm, rangeForm, marketPrice: anchorMid } = tradeFormStore;
    const isLp = whichForm === 'LP' || whichForm === 'RangeLP';

    // Read draft form state — observer() makes the overlay re-render on
    // every form mutation (slider drag, shape toggle, count change, etc).
    let lower: number | undefined;
    let upper: number | undefined;
    let count = 0;
    let shape: LiquidityDistributionShape = LiquidityDistributionShape.FLAT;
    let baseLiq = 0;
    let quoteLiq = 0;
    let customWeights: number[] | null = null;
    if (isLp) {
      if (whichForm === 'LP') {
        lower = lpForm.lowerPriceInput ?? undefined;
        upper = lpForm.upperPriceInput ?? undefined;
        count = lpForm.positions;
        shape = lpForm.liquidityShape;
        baseLiq = parseFloat(lpForm.baseInput) || 0;
        quoteLiq = parseFloat(lpForm.quoteInput) || 0;
        customWeights = lpForm.customWeights;
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

    // Per-rung drag state (P3) — moved up here from below the
    // `if (!pos) return null` so every hook call happens above the
    // early return. Calling any hook after a possible early return
    // makes hook-count diverge across renders (React 19.2 catches
    // this as #310; 19.0 tolerated it silently).
    const rungDragRef = useRef<{
      index: number;
      pointerId: number;
      lastCommit: number;
      lastFrac: number | undefined;
    } | null>(null);
    // Visual live-drag state so the bar tracks the pointer 1:1 during
    // the commit throttle window; only the live-dragged rung is affected.
    const [rungDrag, setRungDrag] = useState<{ index: number; frac: number } | null>(
      null,
    );

    useEffect(() => {
      if (!valid) {
        setPos(null);
        return;
      }
      const lo = lower as number;
      const hi = upper as number;
      const m = mid as number;
      const n = count;

      // Mirror simpleLiquidityPositions on the chain side. When only one
      // side is funded the on-chain path walks all N rungs on the funded
      // side with a monotonic mid→edge shape (PYRAMID = heavy near mid,
      // INVERTED_PYRAMID = heavy at edge). Match that here so the preview
      // reads as a stair, not a bell curve.
      const hasBase = baseLiq > 0;
      const hasQuote = quoteLiq > 0;
      const oneSided = hasBase !== hasQuote;
      const oneSidedFrom = hasBase && !hasQuote ? Math.max(m, lo) : lo;
      const oneSidedTo = hasBase && !hasQuote ? hi : Math.min(m, hi);
      const oneSidedSpan = oneSidedTo - oneSidedFrom;
      const oneSidedBase = hasBase && !hasQuote;
      const monotonicWeightAt = (nearMidIdx: number): number => {
        const t = n === 1 ? 0 : nearMidIdx / (n - 1);
        switch (shape) {
          case LiquidityDistributionShape.PYRAMID:
            return 0.1 + 0.9 * (1 - t);
          case LiquidityDistributionShape.INVERTED_PYRAMID:
            return 0.1 + 0.9 * t;
          case LiquidityDistributionShape.FLAT:
          default:
            return 1;
        }
      };
      const weights: number[] =
        customWeights && customWeights.length === n
          ? customWeights
          : oneSided
            ? Array.from({ length: n }, (_, priceIdx) => {
                // Base one-sided ladders from mid → upper (priceIdx 0 at mid).
                // Quote one-sided ladders from lower → mid (priceIdx n-1 at mid).
                const nearMidIdx = oneSidedBase ? priceIdx : n - 1 - priceIdx;
                return monotonicWeightAt(nearMidIdx);
              })
            : getPositionWeights(n, shape);
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

      const recompute = () => {
        const rungs: Rung[] = [];
        // Walk the same price step the chain-side path uses. For one-sided
        // that's [oneSidedFrom, oneSidedTo]/n so rungs land on the funded
        // side only; for two-sided it's [lo, hi]/n across the full range.
        const step = oneSided && oneSidedSpan > 0 ? oneSidedSpan / n : (hi - lo) / n;
        const start = oneSided && oneSidedSpan > 0 ? oneSidedFrom : lo;
        for (let i = 0; i < n; i++) {
          const price = start + i * step;
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
    }, [
      valid,
      lower,
      upper,
      count,
      shape,
      baseLiq,
      quoteLiq,
      customWeights,
      mid,
      yAtPrice,
      subscribeRedraw,
    ]);

    if (!pos) return null;

    // Format a numeric price for the form store. LP takes numbers,
    // RangeLP takes strings — both stores clamp/validate on their own, we
    // just supply a reasonable precision so the input field reads nicely.
    const commitPrice = (edge: DragEdge, price: number) => {
      if (!Number.isFinite(price) || price <= 0) return;
      if (whichForm === 'LP') {
        // LP stores raw numbers.
        const rounded = Number(price.toPrecision(6));
        if (edge === 'upper') {
          lpForm.setUpperPriceInput(rounded);
        } else {
          lpForm.setLowerPriceInput(rounded);
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

    // ---- Per-rung drag (P3) -------------------------------------------
    // Only meaningful on LP; RangeLP doesn't (yet) expose a
    // per-rung setter and its liquidityTarget is a single number, not a
    // vector. State declared above the early return; handlers below are
    // plain functions that close over those refs.
    const commitRungWeight = (index: number, frac: number) => {
      if (whichForm !== 'LP') return;
      const clamped = Math.max(0, Math.min(1.5, frac));
      lpForm.setCustomWeight(index, clamped);
    };

    const onRungPointerDown =
      (index: number) => (ev: React.PointerEvent<HTMLDivElement>) => {
        if (whichForm !== 'LP') return;
        if (ev.button !== undefined && ev.button !== 0) return;
        const target = ev.currentTarget;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const availWidth = Math.max(1, rect.width - 56);
        const x = Math.max(0, Math.min(availWidth, ev.clientX - rect.left));
        const frac = Math.max(MIN_BAR_FRAC, x / availWidth);
        try {
          target.setPointerCapture(ev.pointerId);
        } catch {
          // best-effort; see edge drag above.
        }
        rungDragRef.current = {
          index,
          pointerId: ev.pointerId,
          lastCommit: 0,
          lastFrac: frac,
        };
        setRungDrag({ index, frac });
        commitRungWeight(index, frac);
        ev.preventDefault();
        ev.stopPropagation();
      };

    const onRungPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = rungDragRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const availWidth = Math.max(1, rect.width - 56);
      const x = Math.max(0, Math.min(availWidth, ev.clientX - rect.left));
      const frac = Math.max(MIN_BAR_FRAC, x / availWidth);
      state.lastFrac = frac;
      setRungDrag({ index: state.index, frac });
      const now = performance.now();
      if (now - state.lastCommit >= RUNG_COMMIT_THROTTLE_MS) {
        state.lastCommit = now;
        commitRungWeight(state.index, frac);
      }
    };

    const onRungPointerUp = (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = rungDragRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch {
        // best-effort
      }
      if (state.lastFrac !== undefined) {
        commitRungWeight(state.index, state.lastFrac);
      }
      rungDragRef.current = null;
      setRungDrag(null);
    };
    // -------------------------------------------------------------------

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
            the LP draft. On LP each bar carries a drag handle at
            the right end so the user can pull it longer/shorter to
            over-ride the shape formula (flips liquidityShape to CUSTOM
            on first drag). */}
        {pos.rungs.map((r, i) => {
          const isDraggingThis = rungDrag?.index === i;
          const naturalFrac = r.qty > 0 ? Math.max(MIN_BAR_FRAC, r.qty / maxQty) : 0;
          const widthFrac = isDraggingThis
            ? Math.max(MIN_BAR_FRAC, rungDrag.frac)
            : naturalFrac;
          const draggable = whichForm === 'LP';
          return (
            <div key={i}>
              <div
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
              {draggable && (
                <div
                  role='slider'
                  aria-label={`Rung ${i + 1} allocation`}
                  className='pointer-events-auto absolute'
                  style={{
                    left: `calc((100% - 56px) * ${widthFrac} - ${BAR_HANDLE_WIDTH / 2}px)`,
                    top: r.y - HANDLE_HIT_HEIGHT / 2,
                    width: BAR_HANDLE_WIDTH + 4,
                    height: HANDLE_HIT_HEIGHT,
                    cursor: 'ew-resize',
                    touchAction: 'none',
                  }}
                  onPointerDown={onRungPointerDown(i)}
                  onPointerMove={onRungPointerMove}
                  onPointerUp={onRungPointerUp}
                  onPointerCancel={onRungPointerUp}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: (HANDLE_HIT_HEIGHT - BAR_HANDLE_WIDTH) / 2,
                      top: (HANDLE_HIT_HEIGHT - 6) / 2,
                      width: BAR_HANDLE_WIDTH,
                      height: 6,
                      background: r.side === 'buy' ? BUY_COLOR : SELL_COLOR,
                      opacity: 0.9,
                      borderRadius: 1,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {/* When the user has hand-edited any bar, expose a small 'reset'
            chip that clears customWeights and drops back to the shape
            formula. Sits at the top-right of the range band. */}
        {whichForm === 'LP' && customWeights && (
          <button
            type='button'
            className='pointer-events-auto absolute rounded-sm bg-base-black/70 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary'
            style={{
              right: 60,
              top: Math.max(0, upperY - 22),
              lineHeight: '14px',
            }}
            onPointerDown={ev => ev.stopPropagation()}
            onClick={() => lpForm.clearCustomWeights()}
          >
            Reset shape
          </button>
        )}
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

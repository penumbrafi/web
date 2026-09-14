import { useEffect, useRef, useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { useMarketPrice } from '../../../model/useMarketPrice';
import type { Drawing } from './types';

interface DrawingsOverlayProps {
  drawings: Drawing[];
  yAtPrice: (price: number) => number | undefined;
  xAtTime: (time: number) => number | undefined;
  /** Reverse mappers for drag-to-move support. */
  priceAtY: (y: number) => number | undefined;
  timeAtX: (x: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  onDelete: (id: string) => void;
  /** Patch a drawing in place (used while dragging an endpoint). */
  onUpdate: (id: string, patch: Partial<Drawing>) => void;
  /** Currently-selected drawing id — drives the inline X-delete glyph. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface PositionedHorizontalLine {
  id: string;
  y: number;
  price: number;
  color: string;
}

interface PositionedVerticalLine {
  id: string;
  x: number;
  time: number;
  color: string;
}

interface PositionedTrendLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Original time/price coords kept here so the drag handler can
   *  translate the line without round-tripping through xAtTime/yAtPrice. */
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  color: string;
}

interface PositionedRectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  color: string;
}

interface PositionedText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

const formatPrice = (p: number): string => {
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toPrecision(4);
};

// Tiny HH:MM label used on vertical beam markers. Vertical lines are
// time-anchored so the label needs to read the click's wall-clock at
// a glance — full datetime is overkill for a chart that already has
// an axis below.
const formatTimeShort = (t: number): string => {
  const d = new Date(t * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

// Inline X-delete glyph shown at a selected drawing's "top-right"-ish
// anchor point. A standalone component (rather than an inline closure) so
// its hover state is a stable per-shape instance across re-renders instead
// of being recreated (and losing hover) whenever the parent redraws.
// Centered on (x, y) via the translate — callers pass the point the glyph
// should sit on, already nudged clear of any resize handle at that corner.
const DeleteGlyph = ({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) => {
  const [hover, setHover] = useState(false);
  return (
    <g
      transform={`translate(${x - 6}, ${y - 6})`}
      className='cursor-pointer'
      pointerEvents='all'
      // Swallow pointerdown so it doesn't fall through to the shape's own
      // (larger) drag/click hit area sitting underneath the glyph.
      onPointerDown={e => e.stopPropagation()}
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <title>Delete drawing</title>
      <rect
        width={12}
        height={12}
        rx={2.5}
        fill={hover ? '#f17878' : 'rgba(13,13,13,0.8)'}
        stroke='#ffffff'
        strokeWidth={1}
        strokeOpacity={0.8}
      />
      <line x1={3} y1={3} x2={9} y2={9} stroke='#ffffff' strokeWidth={1.4} strokeLinecap='round' />
      <line x1={9} y1={3} x2={3} y2={9} stroke='#ffffff' strokeWidth={1.4} strokeLinecap='round' />
    </g>
  );
};

/**
 * SVG overlay rendering user drawings positioned via the candle series's
 * priceToCoordinate. Click a shape's body to open the manage menu
 * (delete / colour) or drag past 4px to move it; click an endpoint /
 * corner handle to reshape. The selected drawing (selectedId) additionally
 * gets an inline X-delete glyph, and responds to the Delete/Backspace and
 * Ctrl/Cmd-C/V shortcuts wired up in chart.tsx.
 */
export const DrawingsOverlay = ({
  drawings,
  yAtPrice,
  xAtTime,
  priceAtY,
  timeAtX,
  subscribeRedraw,
  onDelete,
  onUpdate,
  selectedId,
  onSelect,
}: DrawingsOverlayProps) => {

  const [hLines, setHLines] = useState<PositionedHorizontalLine[]>([]);
  const [vLines, setVLines] = useState<PositionedVerticalLine[]>([]);
  const [tLines, setTLines] = useState<PositionedTrendLine[]>([]);
  const [rects, setRects] = useState<PositionedRectangle[]>([]);
  const [texts, setTexts] = useState<PositionedText[]>([]);
  // Container width, refreshed alongside every recompute — needed to place
  // the horizontal-line X-delete glyph at the right edge (that line itself
  // is drawn x1=0/x2='100%', so there's no numeric right-edge x otherwise).
  const [svgWidth, setSvgWidth] = useState(0);
  // Live chain mid — used to annotate each horizontal-line drawing with
  // its current % gap from mid. The trader marks a level once and the
  // label keeps re-stamping the live distance as mid drifts, no more
  // manual mental arithmetic to gauge whether a level is within reach.
  const { marketPrice } = useMarketPrice();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: string;
    label: string;
  } | null>(null);
  const containerRef = useRef<SVGSVGElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (drawings.length === 0) {
      setHLines([]);
      setVLines([]);
      setTLines([]);
      setRects([]);
      setTexts([]);
      return;
    }

    const recompute = () => {
      const svg = containerRef.current;
      if (svg) setSvgWidth(svg.getBoundingClientRect().width);
      const nextH: PositionedHorizontalLine[] = [];
      const nextV: PositionedVerticalLine[] = [];
      const nextT: PositionedTrendLine[] = [];
      const nextR: PositionedRectangle[] = [];
      const nextTx: PositionedText[] = [];
      for (const d of drawings) {
        if (d.kind === 'horizontal-line') {
          const y = yAtPrice(d.price);
          if (y === undefined) continue;
          nextH.push({ id: d.id, y, price: d.price, color: d.color });
        } else if (d.kind === 'vertical-line') {
          const x = xAtTime(d.time);
          if (x === undefined) continue;
          nextV.push({ id: d.id, x, time: d.time, color: d.color });
        } else if (d.kind === 'trend-line') {
          const x1 = xAtTime(d.time1);
          const y1 = yAtPrice(d.price1);
          const x2 = xAtTime(d.time2);
          const y2 = yAtPrice(d.price2);
          if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
            continue;
          }
          nextT.push({
            id: d.id,
            x1,
            y1,
            x2,
            y2,
            time1: d.time1,
            time2: d.time2,
            price1: d.price1,
            price2: d.price2,
            color: d.color,
          });
        } else if (d.kind === 'rectangle') {
          const x1 = xAtTime(d.time1);
          const y1 = yAtPrice(d.price1);
          const x2 = xAtTime(d.time2);
          const y2 = yAtPrice(d.price2);
          if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
            continue;
          }
          nextR.push({
            id: d.id,
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            time1: d.time1,
            time2: d.time2,
            price1: d.price1,
            price2: d.price2,
            color: d.color,
          });
        } else if (d.kind === 'text') {
          const x = xAtTime(d.time);
          const y = yAtPrice(d.price);
          if (x === undefined || y === undefined) continue;
          nextTx.push({ id: d.id, x, y, text: d.text, color: d.color });
        }
      }
      setHLines(nextH);
      setVLines(nextV);
      setTLines(nextT);
      setRects(nextR);
      setTexts(nextTx);
    };

    return subscribeRedraw(recompute);
  }, [drawings, yAtPrice, xAtTime, subscribeRedraw]);

  useEffect(() => {
    if (!menu) return;
    // Listen on `click`, not `mousedown`. Native mousedown can fire on
    // document before React's synthetic onMouseDown stopPropagation
    // takes effect (React 17+ delegates at the React root container,
    // and the order of native bubble vs. React's stopPropagation isn't
    // strictly guaranteed across browsers / dev vs. prod). Click runs
    // after mouseup, after the button's onClick fires, so the menu's
    // own buttons (Delete, colour-pick) have already run their action.
    const onClick = (e: MouseEvent) => {
      const containerEl = menuRef.current;
      if (containerEl && containerEl.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the menu; Delete / Backspace deletes the drawing
      // it's pointing at — same affordance Bybit / TradingView ship.
      // Skip when focus is in an input/textarea so the user's typing
      // isn't hijacked.
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      const inEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (e.key === 'Escape') {
        setMenu(null);
        onSelect(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inEditable) {
        e.preventDefault();
        onDelete(menu.id);
        onSelect(null);
        setMenu(null);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, onDelete, onSelect]);

  if (drawings.length === 0) return null;

  // Both left-click and right-click open the menu. Left-click is the
  // discoverable affordance; right-click is the legacy one (kept so
  // existing muscle memory still works). preventDefault() suppresses
  // the browser's native context menu on right-click.
  const openMenu = (id: string, label: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = containerRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, id, label });
    onSelect(id);
  };

  // Drag-or-click handler factory for horizontal lines. Pointer-down
  // starts tracking. If pointermove travels >= DRAG_THRESHOLD pixels,
  // we enter drag mode and feed live `price` updates to onUpdate (rAF-
  // coalesced). On release, no movement = click → open manage menu;
  // movement = commit drag (already feeding updates, so just stop).
  // The line stays painted during drag because each onUpdate triggers a
  // re-render with the new y from yAtPrice(price).
  const DRAG_THRESHOLD = 4;

  // Drag a single corner of a two-point shape. xSide selects which
  // time field (time1/time2) tracks horizontal drag; ySide selects
  // which price field (price1/price2) tracks vertical drag. For trend
  // lines you always pass matching pairs (1,1) or (2,2). For
  // rectangles the four corners use mixed pairs to update the right
  // axis-pair: top-left = (1,1), bottom-right = (2,2), top-right =
  // (2,1), bottom-left = (1,2).
  const startEndpointDrag =
    (id: string, xSide: 1 | 2, ySide: 1 | 2 = xSide) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const svg = containerRef.current;
      if (!svg) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      let pendingPatch: Partial<Drawing> | null = null;
      let rafId = 0;
      const flush = () => {
        rafId = 0;
        if (!pendingPatch) return;
        const p = pendingPatch;
        pendingPatch = null;
        onUpdate(id, p);
      };
      const onMove = (ev: PointerEvent) => {
        const rect = svg.getBoundingClientRect();
        const newPrice = priceAtY(ev.clientY - rect.top);
        const newTime = timeAtX(ev.clientX - rect.left);
        if (
          newPrice === undefined ||
          newTime === undefined ||
          !Number.isFinite(newPrice) ||
          !Number.isFinite(newTime)
        ) {
          return;
        }
        pendingPatch = {
          [`time${xSide}`]: newTime,
          [`price${ySide}`]: newPrice,
        } as Partial<Drawing>;
        if (rafId) return;
        rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (rafId) {
          cancelAnimationFrame(rafId);
          flush();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  // Generic drag-or-click handler factory for two-point shapes (trend-
  // line, rectangle). Drag translates the whole shape by the cursor's
  // price/time delta from pointer-down. No movement → open manage menu.
  type TwoPointPatch = {
    time1: number;
    price1: number;
    time2: number;
    price2: number;
  };
  const startTwoPointDrag =
    (
      id: string,
      label: string,
      initial: TwoPointPatch,
    ) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const svg = containerRef.current;
      if (!svg) return;
      // Same anti-chart-pan-capture treatment as horizontal lines.
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const rect0 = svg.getBoundingClientRect();
      const startPrice = priceAtY(startClientY - rect0.top);
      const startTime = timeAtX(startClientX - rect0.left);
      let dragging = false;
      let pendingPatch: Partial<TwoPointPatch> | null = null;
      let rafId = 0;
      const flush = () => {
        rafId = 0;
        if (!pendingPatch) return;
        const p = pendingPatch;
        pendingPatch = null;
        onUpdate(id, p as Partial<Drawing>);
      };
      const onMove = (ev: PointerEvent) => {
        if (!dragging) {
          if (
            Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) <
            DRAG_THRESHOLD
          ) {
            return;
          }
          dragging = true;
        }
        if (
          startPrice === undefined ||
          startTime === undefined ||
          !Number.isFinite(startPrice) ||
          !Number.isFinite(startTime)
        ) {
          return;
        }
        const rect = svg.getBoundingClientRect();
        const curPrice = priceAtY(ev.clientY - rect.top);
        const curTime = timeAtX(ev.clientX - rect.left);
        if (
          curPrice === undefined ||
          curTime === undefined ||
          !Number.isFinite(curPrice) ||
          !Number.isFinite(curTime)
        ) {
          return;
        }
        const dPrice = curPrice - startPrice;
        const dTime = curTime - startTime;
        const newTime1 = initial.time1 + dTime;
        const newTime2 = initial.time2 + dTime;
        const newPrice1 = initial.price1 + dPrice;
        const newPrice2 = initial.price2 + dPrice;
        // Validate: both new endpoints must positionable on the chart.
        // If a translated endpoint would land outside the chart's
        // visible time range, xAtTime/yAtPrice return undefined and
        // recompute would drop the whole shape — the line/rect would
        // visually disappear during the drag. Skip frames that can't
        // commit so the shape stays at its last valid position; the
        // next in-range frame resumes the drag.
        if (
          xAtTime(newTime1) === undefined ||
          xAtTime(newTime2) === undefined ||
          yAtPrice(newPrice1) === undefined ||
          yAtPrice(newPrice2) === undefined
        ) {
          return;
        }
        pendingPatch = {
          time1: newTime1,
          price1: newPrice1,
          time2: newTime2,
          price2: newPrice2,
        };
        if (rafId) return;
        rafId = requestAnimationFrame(flush);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (rafId) {
          cancelAnimationFrame(rafId);
          flush();
        }
        if (!dragging) {
          const rect = svg.getBoundingClientRect();
          setMenu({
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
            id,
            label,
          });
          onSelect(id);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
  const startHLineDrag = (id: string, label: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary click only; right-click → onContextMenu
    const svg = containerRef.current;
    if (!svg) return;
    // Stop the chart's native pan handlers from also seeing this gesture,
    // and pin the pointer to the line element so pointermove/pointerup
    // route directly here instead of through the chart canvas below.
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // older browsers — window-level listeners below still work.
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let pendingPrice: number | null = null;
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      if (pendingPrice === null) return;
      const next = pendingPrice;
      pendingPrice = null;
      onUpdate(id, { price: next });
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
      }
      const rect = svg.getBoundingClientRect();
      const p = priceAtY(ev.clientY - rect.top);
      if (p === undefined || !Number.isFinite(p) || p <= 0) return;
      pendingPrice = p;
      if (rafId) return;
      rafId = requestAnimationFrame(flush);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId) {
        cancelAnimationFrame(rafId);
        flush();
      }
      // No drag → open manage menu (Delete / colour) at the release
      // position. Drag → drag committed live; nothing to do.
      if (!dragging) {
        const rect = svg.getBoundingClientRect();
        setMenu({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          id,
          label,
        });
        onSelect(id);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag-or-click for vertical "beam" lines — same idiom as
  // startHLineDrag but tracking time (x) instead of price (y).
  const startVLineDrag = (id: string, label: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const svg = containerRef.current;
    if (!svg) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let pendingTime: number | null = null;
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      if (pendingTime === null) return;
      const next = pendingTime;
      pendingTime = null;
      onUpdate(id, { time: next });
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
      }
      const rect = svg.getBoundingClientRect();
      const t = timeAtX(ev.clientX - rect.left);
      if (t === undefined || !Number.isFinite(t)) return;
      pendingTime = t;
      if (rafId) return;
      rafId = requestAnimationFrame(flush);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId) {
        cancelAnimationFrame(rafId);
        flush();
      }
      if (!dragging) {
        const rect = svg.getBoundingClientRect();
        setMenu({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          id,
          label,
        });
        onSelect(id);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <svg
        ref={containerRef}
        aria-label='Chart drawings'
        className='pointer-events-none absolute inset-0 z-[6] h-full w-full'
        style={{ overflow: 'visible' }}
      >
        {hLines.map(line => {
          // % distance of this drawn level from the live chain mid. Hide
          // when sub-bp (visual noise) or when mid hasn't loaded.
          const deltaPct =
            marketPrice && marketPrice > 0
              ? ((line.price - marketPrice) / marketPrice) * 100
              : null;
          const showDelta = deltaPct !== null && Math.abs(deltaPct) >= 0.05;
          const deltaText = showDelta
            ? `${deltaPct! > 0 ? '+' : ''}${deltaPct!.toFixed(2)}%`
            : null;
          return (
            <g key={line.id} className='pointer-events-auto'>
              <line
                x1='0'
                x2='100%'
                y1={line.y}
                y2={line.y}
                stroke={line.color}
                strokeWidth='1'
                strokeDasharray='4 3'
              />
              {/* Wider invisible hit area. Pointer-down enters drag-or-
                  click mode: <4px movement = click → open manage menu;
                  drag = move the line live. Right-click also opens
                  the menu directly. */}
              <line
                x1='0'
                x2='100%'
                y1={line.y}
                y2={line.y}
                stroke='transparent'
                strokeWidth='8'
                // SVG quirk: with stroke=transparent the default
                // visiblePainted hit-test ignores the line. `stroke`
                // forces the entire stroke geometry to capture
                // pointer events regardless of fill/stroke colour.
                pointerEvents='stroke'
                style={{ cursor: 'ns-resize' }}
                onPointerDown={startHLineDrag(line.id, formatPrice(line.price))}
                onContextMenu={openMenu(line.id, formatPrice(line.price))}
              >
                <title>
                  Drag to move · click for menu · {formatPrice(line.price)}
                  {deltaText ? ` (${deltaText} from mid)` : ''}
                </title>
              </line>
              <rect
                x='0'
                y={line.y - 7}
                width='52'
                height='14'
                fill={line.color}
                opacity='0.85'
                style={{ cursor: 'ns-resize' }}
                onPointerDown={startHLineDrag(line.id, formatPrice(line.price))}
                onContextMenu={openMenu(line.id, formatPrice(line.price))}
              />
              <text
                x='4'
                y={line.y + 4}
                fill='#0d0d0d'
                fontSize='10'
                fontFamily='monospace'
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {formatPrice(line.price)}
              </text>
              {/* Live mid-delta annotation, rendered to the right of the
                  price label so the price chunk stays the same width. */}
              {deltaText && (
                <text
                  x='56'
                  y={line.y + 4}
                  fill={line.color}
                  fontSize='10'
                  fontFamily='monospace'
                  opacity='0.85'
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {deltaText}
                </text>
              )}
              {/* Inline delete glyph — right edge, level with the line
                  (the "axis end" for a horizontal, price-anchored line). */}
              {selectedId === line.id && svgWidth > 0 && (
                <DeleteGlyph
                  x={svgWidth - 14}
                  y={line.y}
                  onDelete={() => {
                    onDelete(line.id);
                    onSelect(null);
                  }}
                />
              )}
            </g>
          );
        })}

        {/* Vertical "beam" lines — single-click drop, drag-or-click
            for delete/colour. Dashed full-height stroke; small label
            on the bottom edge with a relative time hint. */}
        {vLines.map(line => {
          const labelText = formatTimeShort(line.time);
          return (
            <g key={line.id} className='pointer-events-auto'>
              <line
                x1={line.x}
                x2={line.x}
                y1='0'
                y2='100%'
                stroke={line.color}
                strokeWidth='1'
                strokeDasharray='4 3'
              />
              {/* Wider invisible hit area for easier click + drag. */}
              <line
                x1={line.x}
                x2={line.x}
                y1='0'
                y2='100%'
                stroke='transparent'
                strokeWidth='8'
                pointerEvents='stroke'
                style={{ cursor: 'ew-resize' }}
                onPointerDown={startVLineDrag(line.id, labelText)}
                onContextMenu={openMenu(line.id, labelText)}
              >
                <title>Drag to move · click for menu · {labelText}</title>
              </line>
              <rect
                x={line.x - 26}
                y='2'
                width='52'
                height='14'
                fill={line.color}
                opacity='0.85'
                style={{ cursor: 'ew-resize' }}
                onPointerDown={startVLineDrag(line.id, labelText)}
                onContextMenu={openMenu(line.id, labelText)}
              />
              <text
                x={line.x}
                y='12'
                fill='#0d0d0d'
                fontSize='10'
                fontFamily='monospace'
                textAnchor='middle'
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {labelText}
              </text>
              {/* Inline delete glyph — near the top (time) axis end,
                  offset clear of the time label above it. */}
              {selectedId === line.id && (
                <DeleteGlyph
                  x={line.x}
                  y={26}
                  onDelete={() => {
                    onDelete(line.id);
                    onSelect(null);
                  }}
                />
              )}
            </g>
          );
        })}

        {tLines.map(line => {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const len = Math.hypot(dx, dy);
          const slope =
            len > 0
              ? (((line.price2 - line.price1) / line.price1) * 100).toFixed(2) + '%'
              : '';
          return (
            <g key={line.id} className='pointer-events-auto'>
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={line.color}
                strokeWidth='1.5'
              />
              {/* Wider invisible hit area. Pointer-down enters drag-or-
                  click mode: <4px = click → manage menu; drag = move
                  the whole line by translating both endpoints in
                  price/time. */}
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke='transparent'
                strokeWidth='10'
                pointerEvents='stroke'
                style={{ cursor: 'move' }}
                onPointerDown={startTwoPointDrag(line.id, slope, {
                  time1: line.time1,
                  time2: line.time2,
                  price1: line.price1,
                  price2: line.price2,
                })}
                onContextMenu={openMenu(line.id, slope)}
              >
                <title>Drag to move · click for menu · {slope}</title>
              </line>
              {/* Endpoint handles — visible always so users know
                  they can grab them. r=5 with stroke ring for a
                  clear hit target; pointerEvents='all' so the SVG
                  parent's `none` doesn't block them. Cursor flips
                  to `grab` so it reads as draggable. */}
              <circle
                cx={line.x1}
                cy={line.y1}
                r={5}
                fill={line.color}
                stroke='#ffffff'
                strokeWidth='1.5'
                style={{ cursor: 'grab' }}
                pointerEvents='all'
                onPointerDown={startEndpointDrag(line.id, 1)}
              >
                <title>Drag to reshape (endpoint 1)</title>
              </circle>
              <circle
                cx={line.x2}
                cy={line.y2}
                r={5}
                fill={line.color}
                stroke='#ffffff'
                strokeWidth='1.5'
                style={{ cursor: 'grab' }}
                pointerEvents='all'
                onPointerDown={startEndpointDrag(line.id, 2)}
              >
                <title>Drag to reshape (endpoint 2)</title>
              </circle>
              {/* Inline delete glyph — near the end point (endpoint 2),
                  nudged off it so it doesn't sit on top of the resize
                  handle. */}
              {selectedId === line.id && (
                <DeleteGlyph
                  x={line.x2 + 12}
                  y={line.y2 - 12}
                  onDelete={() => {
                    onDelete(line.id);
                    onSelect(null);
                  }}
                />
              )}
            </g>
          );
        })}

        {rects.map(rect => {
          const lo = Math.min(rect.price1, rect.price2);
          const hi = Math.max(rect.price1, rect.price2);
          const label = `${formatPrice(lo)} – ${formatPrice(hi)}`;
          return (
            <g key={rect.id} className='pointer-events-auto'>
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill={rect.color}
                fillOpacity={0.12}
                stroke={rect.color}
                strokeWidth='1'
                strokeDasharray='4 3'
                style={{ cursor: 'move' }}
                onPointerDown={startTwoPointDrag(rect.id, label, {
                  time1: rect.time1,
                  time2: rect.time2,
                  price1: rect.price1,
                  price2: rect.price2,
                })}
                onContextMenu={openMenu(rect.id, label)}
              >
                <title>Drag to move · click for menu · {label}</title>
              </rect>
              {/* Four corner handles. Each maps a (xSide, ySide) pair
                  to the {time1|time2, price1|price2} field that the
                  drag updates so the *other* corners stay put.
                  cursor flips per corner so the resize affordance is
                  obvious. */}
              {(() => {
                // Figure out which stored corner is at which on-screen
                // position so the drag updates the right field. The
                // rectangle is drawn from min/max, so (rect.x, rect.y)
                // is whichever stored corner has the smaller x AND
                // smaller y — but those can be different stored
                // sides. Compute on-screen sides relative to stored.
                // We don't actually need to know — just update the
                // matching stored side based on which on-screen corner
                // was grabbed. The mapping is encoded in xSide/ySide.
                const handles: Array<{
                  cx: number;
                  cy: number;
                  cursor: string;
                  xSide: 1 | 2;
                  ySide: 1 | 2;
                }> = [];
                // PositionedRectangle stores x = min(x1,x2) so the
                // left edge maps to whichever stored time is smaller.
                // Same for price (top edge = larger price).
                const leftSide: 1 | 2 = rect.time1 <= rect.time2 ? 1 : 2;
                const rightSide: 1 | 2 = leftSide === 1 ? 2 : 1;
                const topSide: 1 | 2 = rect.price1 >= rect.price2 ? 1 : 2;
                const bottomSide: 1 | 2 = topSide === 1 ? 2 : 1;
                handles.push(
                  // top-left: smaller x, smaller y (= higher price)
                  {
                    cx: rect.x,
                    cy: rect.y,
                    cursor: 'nwse-resize',
                    xSide: leftSide,
                    ySide: topSide,
                  },
                  // top-right
                  {
                    cx: rect.x + rect.width,
                    cy: rect.y,
                    cursor: 'nesw-resize',
                    xSide: rightSide,
                    ySide: topSide,
                  },
                  // bottom-left
                  {
                    cx: rect.x,
                    cy: rect.y + rect.height,
                    cursor: 'nesw-resize',
                    xSide: leftSide,
                    ySide: bottomSide,
                  },
                  // bottom-right
                  {
                    cx: rect.x + rect.width,
                    cy: rect.y + rect.height,
                    cursor: 'nwse-resize',
                    xSide: rightSide,
                    ySide: bottomSide,
                  },
                );
                return handles.map((h, i) => (
                  <circle
                    key={i}
                    cx={h.cx}
                    cy={h.cy}
                    r={5}
                    fill={rect.color}
                    stroke='#ffffff'
                    strokeWidth='1.5'
                    style={{ cursor: h.cursor }}
                    pointerEvents='all'
                    onPointerDown={startEndpointDrag(rect.id, h.xSide, h.ySide)}
                  >
                    <title>Drag to reshape</title>
                  </circle>
                ));
              })()}
              {/* Inline delete glyph — top-right corner, nudged clear of
                  that corner's resize handle. */}
              {selectedId === rect.id && (
                <DeleteGlyph
                  x={rect.x + rect.width + 12}
                  y={rect.y - 12}
                  onDelete={() => {
                    onDelete(rect.id);
                    onSelect(null);
                  }}
                />
              )}
            </g>
          );
        })}

        {texts.map(t => {
          const padX = 4;
          const padY = 3;
          // crude width estimate so the bg rect grows with content; SVG can't
          // measure text without a render pass, so we approximate at 6.5px/char.
          const approxWidth = Math.max(20, t.text.length * 6.5 + padX * 2);
          return (
            <g key={t.id} className='pointer-events-auto'>
              <rect
                x={t.x}
                y={t.y - 11}
                width={approxWidth}
                height={18}
                fill={t.color}
                opacity={0.85}
                rx={2}
                style={{ cursor: 'pointer' }}
                onClick={openMenu(t.id, t.text)}
                onContextMenu={openMenu(t.id, t.text)}
              >
                <title>Click to delete · {t.text}</title>
              </rect>
              <text
                x={t.x + padX}
                y={t.y + padY}
                fill='#0d0d0d'
                fontSize='11'
                fontFamily='system-ui, sans-serif'
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {t.text}
              </text>
              {/* Inline delete glyph — top-right corner of the label. */}
              {selectedId === t.id && (
                <DeleteGlyph
                  x={t.x + approxWidth + 8}
                  y={t.y - 11}
                  onDelete={() => {
                    onDelete(t.id);
                    onSelect(null);
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {menu && (
        <div
          ref={menuRef}
          role='menu'
          className='absolute z-30 min-w-[200px] overflow-hidden rounded-sm border border-other-tonal-stroke bg-base-black shadow-lg'
          style={{ left: menu.x, top: menu.y }}
        >
          <div className='border-b border-b-other-tonal-stroke px-3 py-2'>
            <Text detail color='text.secondary'>
              drawing
            </Text>
            <div className='font-mono text-sm text-text-primary'>{menu.label}</div>
          </div>
          <div className='border-b border-b-other-tonal-stroke px-3 py-2'>
            <Text detail color='text.secondary'>
              color
            </Text>
            <div className='mt-1 flex gap-1.5'>
              {DRAWING_COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type='button'
                  aria-label={`Set drawing colour ${c}`}
                  onClick={() => {
                    onUpdate(menu.id, { color: c });
                    setMenu(null);
                  }}
                  className='h-5 w-5 rounded-sm border border-other-tonal-stroke transition-transform hover:scale-110'
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <button
            type='button'
            role='menuitem'
            onClick={() => {
              onDelete(menu.id);
              onSelect(null);
              setMenu(null);
            }}
            className='flex w-full items-center px-3 py-2 text-left text-destructive-light transition-colors hover:bg-action-hover-overlay'
          >
            <Text detail>Delete drawing</Text>
          </button>
        </div>
      )}
    </>
  );
};

// Color presets matching veil's brand palette. Penumbra teal first
// (the new default), orange (former default — primary.light, still
// useful for accent), green/red (buy/sell hints), neutral.
const DRAWING_COLOR_PRESETS = [
  '#53aea8', // secondary.light — Penumbra teal, default
  '#f49c43', // primary.light — orange accent
  '#55d383', // success.light — green
  '#f17878', // destructive.light — red
  '#d4d4d4', // neutral light — subtle marker
];

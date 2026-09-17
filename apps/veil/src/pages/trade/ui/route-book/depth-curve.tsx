import { memo, useMemo } from 'react';
import type { Trace } from '@/shared/api/server/book/types';

// MEXC-style depth curve overlaid on the route-book ladder. Draws a
// step-after filled area whose x-extent at each row equals that row's
// cumulative-depth percentage (already computed by
// `calculateCumulativeDepthByPrice` and passed in as `relativeSizes`),
// stretched vertically to cover the row's full 32px slot.
//
// Rendered as a CSS-grid sibling of the row divs (not a wrapping div —
// wrappers break `grid-cols-subgrid` on the rows themselves). The SVG
// spans all columns of the ladder and the same grid rows as its
// side's `TradeRow`s. Row height comes from the parent grid's
// `auto-rows-[32px]`; the SVG scales via `preserveAspectRatio='none'`,
// so a row-count change is the only input path math cares about.

const ROW_PX = 32;

interface Props {
  // Rows in display order. Sells: worst price at top, touch at bottom.
  // Buys:  touch at top, worst at bottom. Same order the `.map()` in
  // book.tsx uses to render <TradeRow>s.
  rows: Trace[];
  relativeSizes: Map<string, number>;
  side: 'sell' | 'buy';
  // Grid row this section starts on (1-indexed CSS grid line). Header
  // is row 1, so sells start at 2; buys start at (2 + n_sells + spread).
  gridRowStart: number;
}

const DepthCurveImpl = ({ rows, relativeSizes, side, gridRowStart }: Props) => {
  const n = rows.length;

  // Path is a step-after polygon: horizontal segment at each row's width
  // across the full row height, vertical jump between rows. Anchored
  // on the right edge so the "shape" is the deep side of the ladder.
  const d = useMemo(() => {
    if (n === 0) return '';
    const parts: string[] = ['M 100,0'];
    for (let i = 0; i < n; i++) {
      const trace = rows[i]!;
      // Clamp to [0, 100] so a malformed size (shouldn't happen given
      // `calculateCumulativeDepthByPrice` output, but cheap insurance)
      // can never draw off-canvas.
      const size = Math.max(0, Math.min(100, relativeSizes.get(trace.price) ?? 0));
      const leftX = 100 - size;
      // Horizontal at row-top, then descend to row-bottom at the same x.
      parts.push(`L ${leftX},${i}`);
      parts.push(`L ${leftX},${i + 1}`);
    }
    parts.push(`L 100,${n}`);
    parts.push('Z');
    return parts.join(' ');
  }, [rows, relativeSizes, n]);

  if (n === 0) return null;

  const fill =
    side === 'sell'
      ? 'rgba(175, 38, 38, 0.32)' // matches TradeRow's SELL_BG_COLOR
      : 'rgba(28, 121, 63, 0.32)'; // matches TradeRow buy bar

  return (
    <svg
      aria-hidden
      className='pointer-events-none'
      style={{
        gridColumn: '1 / -1',
        gridRow: `${gridRowStart} / span ${n}`,
        // Match the row grid: SVG stretches to the same total height
        // the rows occupy, so the step-after path lines up 1:1 with row
        // boundaries.
        width: '100%',
        height: n * ROW_PX,
        alignSelf: 'stretch',
      }}
      viewBox={`0 0 100 ${n}`}
      preserveAspectRatio='none'
    >
      <path d={d} fill={fill} />
    </svg>
  );
};

// Custom equality — path recomputes only when row identity or a size
// actually changes. Reference equality on the sizes Map is fine; book.tsx
// rebuilds it in useMemo tied to the same deps.
export const DepthCurve = memo(DepthCurveImpl, (a, b) => {
  if (a.side !== b.side) return false;
  if (a.gridRowStart !== b.gridRowStart) return false;
  if (a.rows !== b.rows) return false;
  if (a.relativeSizes !== b.relativeSizes) return false;
  return true;
});

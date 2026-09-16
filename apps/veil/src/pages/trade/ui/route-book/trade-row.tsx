import { Fragment, memo } from 'react';
import cn from 'clsx';
import { ChevronRight } from 'lucide-react';
import { getSymbolFromValueView } from '@penumbra-zone/getters/value-view';
import { Text } from '@penumbra-zone/ui/Text';
import { Trace } from '@/shared/api/server/book/types.ts';
import { pluralize } from '@/shared/utils/pluralize';
import { pnum } from '@penumbra-zone/types/pnum';

// MEXC-style depth: saturated bars filling from the right edge of the row
// (where the cumulative totals sit) inward, leaving the price column on
// the left fully readable. Slightly more opaque than the previous
// fill-from-left form so the depth shape is visible at a glance.
const SELL_BG_COLOR = 'rgba(175, 38, 38, 0.32)';

const TradeRowImpl = ({
  trace,
  isSell,
  relativeSize,
  onClick,
  fillFraction,
  depthBar = true,
}: {
  trace: Trace;
  isSell: boolean;
  relativeSize: number;
  onClick?: (price: string) => void;
  // 0..1 fraction of this level's inventory the current draft order would
  // consume. Undefined means the row isn't touched by the draft.
  fillFraction?: number;
  // Whether the per-row depth bar renders behind the row. Off when the
  // parent draws a unified DepthCurve SVG across the ladder instead of
  // per-row bars — cleaner "depth graph" read. Default keeps the old
  // MEXC-style bar so callers that don't opt in are unchanged.
  depthBar?: boolean;
}) => {
  const bgColor = isSell ? SELL_BG_COLOR : 'rgba(28, 121, 63, 0.32)';
  const tokens = trace.hops.map(valueView => getSymbolFromValueView(valueView));
  const interactive = !!onClick;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick ? () => onClick(trace.price) : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(trace.price);
              }
            }
          : undefined
      }
      title={interactive ? `Click to ${isSell ? 'buy' : 'sell'} at this price` : undefined}
      style={
        depthBar
          ? {
              // Fill from the right edge inward — `to left` reads the
              // gradient stops as 'paint colour from the right up to
              // relativeSize%, then transparent the rest of the way to
              // the left'. Mirrors MEXC / Bybit / Binance depth viz so
              // the price column on the left stays unobstructed.
              backgroundImage: `linear-gradient(to left, ${bgColor} ${relativeSize}%, transparent ${relativeSize}%)`,
            }
          : undefined
      }
      className={cn(
        'relative col-span-4 grid h-full grid-cols-subgrid items-center border-b border-other-tonal-fill15 px-4',
        'after:absolute after:right-0 after:left-0 after:hidden after:h-full after:bg-other-tonal-fill5 after:content-[""]',
        'group hover:after:block [&:hover>span:not(:last-child)]:invisible',
        'text-xs tabular-nums', // makes all numbers monospaced
        interactive && 'cursor-pointer',
        fillFraction !== undefined && fillFraction > 0 && 'border-l-2 border-l-primary-main',
      )}
    >
      {fillFraction !== undefined && fillFraction > 0 && (
        // Simulation overlay — a translucent stripe from the left showing
        // what fraction of this level's inventory the current draft order
        // would eat. Sits above the depth gradient so the trader sees the
        // order impact at a glance without the depth colour drowning it.
        <div
          aria-hidden
          className='pointer-events-none absolute inset-y-0 left-0 bg-primary-main/25'
          style={{ width: `${Math.min(100, Math.max(0, fillFraction * 100))}%` }}
        />
      )}
      <Text detailTechnical color={isSell ? 'destructive.light' : 'success.light'}>
        {pnum(trace.price).toFormattedString({
          commas: false,
          decimals: 7,
        })}
      </Text>
      <Text detailTechnical align='right' color='text.primary'>
        {pnum(trace.amount).toFormattedString({
          commas: false,
          decimals: 6,
        })}
      </Text>
      <Text detailTechnical align='right' color='text.primary'>
        {pnum(trace.total).toFormattedString({
          commas: false,
          decimals: 6,
        })}
      </Text>
      <Text
        tableItemSmall
        align='right'
        color={trace.hops.length <= 2 ? 'text.primary' : 'text.special'}
      >
        {trace.hops.length === 2 ? 'Direct' : pluralize(trace.hops.length - 2, 'Hop', 'Hops')}
      </Text>

      {/* Route display that shows on hover */}
      <div
        className='absolute right-0 left-0 z-30 hidden justify-center px-4 select-none group-hover:flex'
        style={{ visibility: 'visible' }}
      >
        <div className='flex items-center gap-1 py-2 text-xs'>
          {tokens.map((token, index) => (
            <Fragment key={index}>
              {index > 0 && <ChevronRight className='h-3 w-3 text-neutral-light' />}
              <Text tableItemSmall color='text.primary'>
                {token}
              </Text>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * useBook re-fetches every block (~5s), and accumulate() in book.tsx
 * allocates a fresh `trace` object per row in cumulative mode. Without
 * memo, every row would re-render on every poll even when its visible
 * fields (price/amount/total/hops) didn't change. Custom equality
 * compares the primitive fields directly so allocation churn doesn't
 * bust the memo.
 */
export const TradeRow = memo(TradeRowImpl, (prev, next) => {
  if (
    prev.isSell !== next.isSell ||
    prev.relativeSize !== next.relativeSize ||
    prev.onClick !== next.onClick ||
    prev.fillFraction !== next.fillFraction ||
    prev.depthBar !== next.depthBar
  ) {
    return false;
  }
  const a = prev.trace;
  const b = next.trace;
  if (a.price !== b.price || a.amount !== b.amount || a.total !== b.total) {
    return false;
  }
  if (a.hops.length !== b.hops.length) return false;
  // Reference equality on hops is fine — the upstream serializer
  // re-uses ValueView instances when the hop structure is stable.
  for (let i = 0; i < a.hops.length; i++) {
    if (a.hops[i] !== b.hops[i]) return false;
  }
  return true;
});

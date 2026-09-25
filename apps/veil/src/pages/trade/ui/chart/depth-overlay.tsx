import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { pnum } from '@penumbra-zone/types/pnum';
import { theme } from '@penumbra-zone/ui/theme';
import { useBook } from '../../api/book';
import { tradeFormStore } from '../order-form/store/OrderFormStore';

interface Level {
  price: number;
  total: number;
}

interface BarPos {
  id: string;
  side: 'bid' | 'ask';
  price: number;
  y: number;
  width: number;
  color: string;
  /** Pre-rendered tooltip — `Bid 0.123 (-1.23%) · click to sell here`. */
  title: string;
}

interface DepthOverlayProps {
  yAtPrice: (price: number) => number | undefined;
  /** Subscribe to chart events. Returns an unsubscribe. */
  subscribeRedraw: (cb: () => void) => () => void;
  /** Width of the overlay column in pixels. Leaves room for the price axis. */
  width?: number;
}

const buildLevels = (
  buys: { price: string; total: string }[],
  sells: { price: string; total: string }[],
): { bids: Level[]; asks: Level[]; max: number } | undefined => {
  const toLevel = (t: { price: string; total: string }): Level => ({
    price: pnum(t.price).toNumber(),
    total: pnum(t.total).toNumber(),
  });
  const filt = (l: Level) =>
    Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.total) && l.total > 0;

  const bids = buys.map(toLevel).filter(filt);
  const asks = sells.map(toLevel).filter(filt);
  if (!bids.length && !asks.length) {return undefined;}
  let max = 0;
  for (const l of bids) {if (l.total > max) {max = l.total;}}
  for (const l of asks) {if (l.total > max) {max = l.total;}}
  return { bids, asks, max };
};

const formatPrefill = (price: number): string => {
  if (price >= 1) {return price.toFixed(4);}
  if (price >= 0.01) {return price.toFixed(5);}
  return price.toPrecision(4);
};

const prefill = (price: number, side: 'bid' | 'ask') => {
  const formatted = formatPrefill(price);
  tradeFormStore.setWhichForm('Limit');
  tradeFormStore.limitForm.setDirection(side === 'bid' ? 'sell' : 'buy');
  tradeFormStore.limitForm.setPriceInput(formatted);
};

const formatPriceCompact = (p: number): string => {
  if (p >= 1) {return p.toFixed(4);}
  if (p >= 0.01) {return p.toFixed(5);}
  if (p >= 0.0001) {return p.toFixed(6);}
  return p.toPrecision(4);
};

// One memoized bar per book level. The depth overlay re-renders every
// block via useBook; without memo each of 30+ bars would re-allocate
// its inline style + onClick closure per tick. memo() with primitive
// props (top, width, color, price, side, title) lets React skip every
// bar whose level data hasn't moved between blocks. The internal style
// memo + useCallback keep the bar's own DOM listener / style identity
// stable, the same idiom we use on OrderInput and LiquidityShape.
const DepthBar = memo(
  ({
    top,
    width,
    color,
    price,
    side,
    title,
  }: {
    top: number;
    width: number;
    color: string;
    price: number;
    side: 'bid' | 'ask';
    title: string;
  }) => {
    // Taller bars so each level reads as a row (MEXC-style heatmap)
    // not a thin sliver. Levels near mid sit close together
    // vertically, so 4px stripes blur into a continuous gradient
    // band near the touch and stay distinct further out.
    const style = useMemo(
      () => ({
        top,
        height: 4,
        width,
        background: color,
        opacity: 0.55,
      }),
      [top, width, color],
    );
    const onClick = useCallback(() => prefill(price, side), [price, side]);
    return (
      <div
        className='pointer-events-auto absolute right-0 cursor-pointer'
        style={style}
        onClick={onClick}
        title={title}
      />
    );
  },
);

DepthBar.displayName = 'DepthBar';

// Default 40px wide, anchored to right: 56 — sits in a dedicated
// column *immediately left of* the price-axis labels (which occupy
// the rightmost ~56px). Mirrors MEXC's depth-heatmap-next-to-price-
// ladder layout: bars don't bleed into the candle area on the left
// or obscure the price labels on the right.
const DEPTH_COLUMN_RIGHT = 56;
export const DepthOverlay = observer(
  ({ yAtPrice, subscribeRedraw, width = 40 }: DepthOverlayProps) => {
    const { data } = useBook();

    const levels = useMemo(() => {
      if (!data?.multiHops) {return undefined;}
      return buildLevels(data.multiHops.buy, data.multiHops.sell);
    }, [data]);

    // Mid is the average of best bid + best ask off the levels we just
    // built — read from the same source the SpreadRow uses so the tooltip
    // %s line up with everywhere else mid is shown. Computed alongside
    // bars (not via useMarketPrice) so the title strings refresh in lock
    // step with the bar geometry instead of trailing a frame behind.
    const mid = useMemo(() => {
      if (!levels) {return undefined;}
      const bestBid = levels.bids[0]?.price;
      const bestAsk = levels.asks[levels.asks.length - 1]?.price;
      if (bestBid === undefined || bestAsk === undefined) {return undefined;}
      return (bestBid + bestAsk) / 2;
    }, [levels]);

    const [bars, setBars] = useState<BarPos[]>([]);

    useEffect(() => {
      if (!levels) {
        setBars([]);
        return;
      }
      const recompute = () => {
        const max = levels.max || 1;
        // sqrt scaling so deep books still show smaller levels visibly
        const scale = (v: number) => Math.trunc(Math.sqrt(v / max) * width * 0.95);
        const next: BarPos[] = [];
        const push = (side: 'bid' | 'ask', rows: Level[], color: string) => {
          for (const lvl of rows) {
            const y = yAtPrice(lvl.price);
            if (y === undefined) {continue;}
            const deltaPct =
              mid !== undefined && mid > 0 ? ((lvl.price - mid) / mid) * 100 : null;
            const deltaText =
              deltaPct !== null && Math.abs(deltaPct) >= 0.05
                ? ` (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`
                : '';
            const sideLabel = side === 'bid' ? 'Bid' : 'Ask';
            const action = side === 'bid' ? 'sell' : 'buy';
            next.push({
              id: `${side}-${lvl.price}`,
              side,
              price: lvl.price,
              y,
              width: Math.max(1, scale(lvl.total)),
              color,
              title: `${sideLabel} ${formatPriceCompact(lvl.price)}${deltaText} · click to ${action} here`,
            });
          }
        };
        push('bid', levels.bids, theme.color.success.light);
        push('ask', levels.asks, theme.color.destructive.light);
        setBars(next);
      };
      // subscribeRedraw fires once immediately and on relevant chart events.
      return subscribeRedraw(recompute);
    }, [levels, mid, yAtPrice, subscribeRedraw, width]);

    if (!levels) {return null;}

    return (
      <div
        aria-label='Order book depth overlay'
        className='pointer-events-none absolute top-0 bottom-0 z-[5]'
        // Anchor immediately left of the price-axis labels (which
        // occupy the rightmost ~56px). Gives the depth bars their
        // own column without overlapping price text or chart candles.
        style={{ right: DEPTH_COLUMN_RIGHT, width }}
        title='Click a depth bar to set the limit price'
      >
        {bars.map(b => (
          <DepthBar
            key={b.id}
            top={b.y - 2}
            width={b.width}
            color={b.color}
            price={b.price}
            side={b.side}
            title={b.title}
          />
        ))}
      </div>
    );
  },
);

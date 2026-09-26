'use client';

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { connectionStore } from '@/shared/model/connection';
import { useLatestSwaps } from '../../api/latest-swaps';
import { usePathToMetadata } from '../../model/use-path';

// Same colour split the LP overlay uses: green = buy, red = sell.
const BUY_COLOR = '#55d383';
const SELL_COLOR = '#f17878';
// Constant dot diameter in CSS pixels, independent of zoom or of how many
// fills share a bar. The library's canvas markers clamped to 12–30px and
// stacked on the wick, so a busy candle ballooned them; a DOM dot can't.
const DOT_SIZE = 8;
// Comfortably larger transparent hit target for hover, so the 8px dot is
// still easy to point at without a pixel hunt.
const HIT_SIZE = 18;

interface Fill {
  key: string;
  /** UNIX seconds. */
  time: number;
  /** Execution price, denominated in quote. */
  price: number;
  direction: 'buy' | 'sell';
  amount: string;
  symbol: string;
}

interface Props {
  xAtTime: (time: number) => number | undefined;
  yAtPrice: (price: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  enabled: boolean;
}

const formatTime = (s: number): string => {
  const d = new Date(s * 1000);
  return d.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Renders the user's recent swap fills on the active pair as small dots
 * pinned to the *executed price* and the fill time — not to the bar
 * high/low, which is where lightweight-charts' `setMarkers` put them.
 *
 * Each dot resolves its screen position through the chart's own
 * time→x / price→y mappers and recomputes on `subscribeRedraw`, so it
 * tracks pan/zoom/resize exactly like the LP drag handles do. The dot
 * itself is a fixed 8px; a sibling transparent 18px box carries the
 * hover target and the native tooltip with price paid, amount, side and
 * time.
 *
 * Fully hidden while `enabled` is false, so the Chart-overlays toggle
 * shows/hides them without a reload.
 */
export const OwnFillsOverlay: FC<Props> = observer(
  ({ xAtTime, yAtPrice, subscribeRedraw, enabled }) => {
    const { connected, subaccount } = connectionStore;
    const { baseSymbol, quoteSymbol } = usePathToMetadata();
    const { data: fills } = useLatestSwaps(subaccount);

    const markers: Fill[] = useMemo(() => {
      if (!connected || !enabled || !fills?.length) {return [];}
      const out: Fill[] = [];
      for (const f of fills) {
        const t = Date.parse(f.timestamp);
        const price = Number(f.price);
        if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) {continue;}
        out.push({
          key: `${f.timestamp}-${f.kind}-${f.price}-${f.amount}`,
          time: Math.floor(t / 1000),
          price,
          direction: f.kind,
          amount: f.amount,
          // recent-executions formats a sell in base units and a buy in
          // quote units, so the amount's symbol follows the direction.
          symbol: f.kind === 'buy' ? quoteSymbol : baseSymbol,
        });
      }
      return out;
    }, [connected, enabled, fills, baseSymbol, quoteSymbol]);

    // Recompute the pixel position of every fill on each chart repaint
    // (pan/zoom/resize/setData). Kept in a ref so the subscribeRedraw
    // callback reads fresh markers without re-subscribing.
    const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
    const [, force] = useState(0);
    useEffect(() => {
      const update = () => {
        const m = new Map<string, { x: number; y: number }>();
        for (const fill of markers) {
          const x = xAtTime(fill.time);
          const y = yAtPrice(fill.price);
          if (x !== undefined && y !== undefined) {m.set(fill.key, { x, y });}
        }
        posRef.current = m;
        force(v => v + 1);
      };
      const unsub = subscribeRedraw(update);
      return unsub;
    }, [markers, xAtTime, yAtPrice, subscribeRedraw]);

    if (!enabled || markers.length === 0) {return null;}

    return (
      <div
        aria-label='Your recent fills'
        className='pointer-events-none absolute inset-0 z-[6]'
      >
        {markers.map(fill => {
          const pos = posRef.current.get(fill.key);
          if (!pos) {return null;}
          const color = fill.direction === 'buy' ? BUY_COLOR : SELL_COLOR;
          const sideLabel = fill.direction === 'buy' ? 'Buy' : 'Sell';
          const tooltip =
            `${sideLabel} · ${fill.amount} ${fill.symbol} @ ${fill.price.toPrecision(6)}\n` +
            formatTime(fill.time);
          return (
            <div
              key={fill.key}
              className='pointer-events-auto absolute flex items-center justify-center'
              style={{
                left: pos.x - HIT_SIZE / 2,
                top: pos.y - HIT_SIZE / 2,
                width: HIT_SIZE,
                height: HIT_SIZE,
                // Plain arrow, not '?': the hover title explains it.
                  cursor: 'default',
              }}
              title={tooltip}
            >
              <div
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  background: color,
                  opacity: 0.95,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                }}
              />
            </div>
          );
        })}
      </div>
    );
  },
);

OwnFillsOverlay.displayName = 'OwnFillsOverlay';
'use client';

import { useEffect, useState } from 'react';
import type { PriceAlert } from './use-price-alerts';

interface AlertsOverlayProps {
  alerts: PriceAlert[];
  yAtPrice: (price: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  onRemove: (id: string) => void;
}

interface PositionedAlert {
  id: string;
  y: number;
  price: number;
  direction: 'above' | 'below';
}

const formatPrice = (p: number): string => {
  if (p >= 1) {return p.toFixed(4);}
  if (p >= 0.01) {return p.toFixed(5);}
  if (p >= 0.0001) {return p.toFixed(6);}
  return p.toPrecision(4);
};

const ALERT_COLOR = '#f49c43'; // primary.light

/**
 * Renders each active price alert as a thin dotted horizontal line on
 * the chart with a small price-label tag on the LEFT edge and an × on
 * the RIGHT edge. Click × → removes the alert. Same DOM-overlay idiom
 * as MidPriceOverlay so it can't take down the chart canvas.
 */
export const AlertsOverlay = ({
  alerts,
  yAtPrice,
  subscribeRedraw,
  onRemove,
}: AlertsOverlayProps) => {
  const [positioned, setPositioned] = useState<PositionedAlert[]>([]);

  useEffect(() => {
    if (!alerts.length) {
      setPositioned([]);
      return;
    }
    const recompute = () => {
      const next: PositionedAlert[] = [];
      for (const a of alerts) {
        if (a.triggeredAt) {continue;} // only show active alerts on chart
        const y = yAtPrice(a.targetPrice);
        if (y === undefined) {continue;}
        next.push({ id: a.id, y, price: a.targetPrice, direction: a.direction });
      }
      setPositioned(next);
    };
    return subscribeRedraw(recompute);
  }, [alerts, yAtPrice, subscribeRedraw]);

  if (!positioned.length) {return null;}

  return (
    <div
      aria-label='Price alerts'
      className='pointer-events-none absolute inset-0 z-[6]'
    >
      {positioned.map(a => (
        <div key={a.id} className='absolute right-0 left-0' style={{ top: a.y - 1, height: 2 }}>
          {/* Dotted line spanning the chart width — leaves the price-
              axis area clear (right: 56) so it doesn't fight depth bars
              or mid-price label. */}
          <div
            className='absolute left-0'
            style={{
              right: 56,
              top: 0,
              height: 1,
              borderTop: `1px dotted ${ALERT_COLOR}`,
              opacity: 0.7,
            }}
          />
          {/* Left-edge label: 🔔 + direction + price. Left-anchored so
              it doesn't compete with the right-edge mid label. */}
          <div
            className='pointer-events-auto absolute -translate-y-1/2 cursor-default rounded-sm px-1.5 py-px text-[10px] leading-tight tabular-nums'
            style={{
              left: 0,
              top: 1,
              background: ALERT_COLOR,
              color: '#0d0d0d',
            }}
            title={`Alert when price goes ${a.direction} ${formatPrice(a.price)}`}
          >
            🔔 {a.direction === 'above' ? '↑' : '↓'} {formatPrice(a.price)}
          </div>
          {/* Right-edge × button (just inside the price axis). Removes
              the alert when clicked. */}
          <button
            type='button'
            aria-label='Remove alert'
            title='Remove this alert'
            onClick={() => onRemove(a.id)}
            className='pointer-events-auto absolute flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-[11px] leading-none transition-colors'
            style={{
              right: 60,
              top: 1,
              background: ALERT_COLOR,
              color: '#0d0d0d',
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

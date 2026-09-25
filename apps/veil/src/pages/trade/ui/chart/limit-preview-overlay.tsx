'use client';

import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tradeFormStore } from '../order-form/store/OrderFormStore';

interface LimitPreviewOverlayProps {
  yAtPrice: (price: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
}

const BUY_COLOR = '#55d383';
const SELL_COLOR = '#f17878';

const formatPrice = (p: number): string => {
  if (p >= 1) {return p.toFixed(4);}
  if (p >= 0.01) {return p.toFixed(5);}
  if (p >= 0.0001) {return p.toFixed(6);}
  return p.toPrecision(4);
};

/**
 * Shadow line for the limit order the trader is currently composing.
 * Renders only when the Limit form is active and a price is typed —
 * the line shows up green/red depending on direction, dashed so it
 * reads as 'preview, not yet placed'. Includes a small label with
 * direction + size + price + the % gap to mid, so the trader can see
 * exactly where the order will sit relative to the live touch before
 * pressing Submit. Same DOM-overlay plumbing as MidPriceOverlay /
 * LpPreviewOverlay so it can't take the chart down.
 */
export const LimitPreviewOverlay = observer(
  ({ yAtPrice, subscribeRedraw }: LimitPreviewOverlayProps) => {
    const { whichForm, limitForm, marketPrice } = tradeFormStore;

    const isActive = whichForm === 'Limit';
    const priceStr = limitForm.priceInput;
    const baseAmount = limitForm.baseInput;
    const direction = limitForm.direction;
    const baseSymbol = limitForm.baseAsset?.symbol;

    const price = parseFloat(priceStr);
    const valid =
      isActive && Number.isFinite(price) && price > 0;

    const [y, setY] = useState<number | undefined>(undefined);

    useEffect(() => {
      if (!valid) {
        setY(undefined);
        return;
      }
      const recompute = () => setY(yAtPrice(price));
      return subscribeRedraw(recompute);
    }, [valid, price, yAtPrice, subscribeRedraw]);

    if (!valid || y === undefined) {return null;}

    const color = direction === 'buy' ? BUY_COLOR : SELL_COLOR;
    const sideLabel = direction === 'buy' ? 'Buy' : 'Sell';

    // Spread / cross indicator: a buy at price >= mid crosses the spread
    // (executes as taker), and a sell at price <= mid likewise. Surface
    // that in the label so the trader doesn't accidentally submit a
    // crossing limit thinking they're posting maker.
    const wouldCross =
      marketPrice && marketPrice > 0
        ? direction === 'buy'
          ? price >= marketPrice
          : price <= marketPrice
        : false;
    const deltaPct =
      marketPrice && marketPrice > 0 ? ((price - marketPrice) / marketPrice) * 100 : null;
    const deltaText =
      deltaPct !== null && Math.abs(deltaPct) >= 0.05
        ? ` · ${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}% from mid`
        : '';
    const sizeText =
      baseAmount && parseFloat(baseAmount) > 0 && baseSymbol
        ? `${baseAmount} ${baseSymbol}`
        : '';

    return (
      <div
        aria-label='Limit order preview'
        className='pointer-events-none absolute right-0 left-0 z-[6]'
        style={{ top: y - 1, height: 2 }}
      >
        <div
          className='absolute left-0'
          style={{
            right: 56,
            top: 0,
            height: 1,
            borderTop: `1px dashed ${color}`,
            opacity: 0.85,
          }}
        />
        <div
          className='absolute -translate-y-1/2 rounded-sm px-1.5 py-px text-[10px] leading-tight'
          style={{
            right: 60,
            top: 1,
            background: color,
            color: '#0d0d0d',
          }}
        >
          {sideLabel}
          {sizeText ? ` ${sizeText}` : ''} @ {formatPrice(price)}
          {wouldCross ? ' · would cross' : deltaText}
        </div>
      </div>
    );
  },
);

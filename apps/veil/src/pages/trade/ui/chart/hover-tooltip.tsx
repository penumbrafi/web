'use client';

import { useEffect, useState } from 'react';
import { useMarketPrice } from '../../model/useMarketPrice';

interface HoverInfo {
  time: number;
  candle: { open: number; high: number; low: number; close: number };
  volume: number | undefined;
  point: { x: number; y: number };
}

interface HoverTooltipProps {
  subscribeHover: (cb: (info: HoverInfo | null) => void) => () => void;
  quoteSymbol: string;
}

const formatPrice = (p: number): string => {
  if (!Number.isFinite(p)) return '-';
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toPrecision(4);
};

const formatVolume = (v: number): string => {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(4);
};

const formatTime = (s: number): string => {
  const d = new Date(s * 1000);
  return d.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const HoverTooltip = ({ subscribeHover, quoteSymbol }: HoverTooltipProps) => {
  const [info, setInfo] = useState<HoverInfo | null>(null);
  // Live chain mid — used to annotate the hovered candle's close with how
  // far it sat from where the book is right now. Useful when scrubbing
  // back through history: the trader can see at a glance which candles
  // closed at prices significantly different from the current touch.
  const { marketPrice } = useMarketPrice();

  // lightweight-charts' subscribeCrosshairMove fires on every pointer move
  // over the canvas — that's 30-60 events/s while the user is hovering.
  // Coalesce to one setState per animation frame so React reconciles the
  // tooltip at most once per paint, instead of dozens of times per second.
  useEffect(() => {
    const pendingRef = { current: null as HoverInfo | null };
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      setInfo(pendingRef.current);
    };
    const off = subscribeHover(next => {
      pendingRef.current = next;
      // Render the leave (null) immediately so the tooltip doesn't linger
      // a frame after the cursor exits the chart — a stale tooltip on
      // an empty area looks broken.
      if (next === null) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        setInfo(null);
        return;
      }
      if (rafId) return;
      rafId = requestAnimationFrame(flush);
    });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      off();
    };
  }, [subscribeHover]);

  if (!info) return null;

  const isUp = info.candle.close >= info.candle.open;
  const directionColor = isUp ? 'text-success-light' : 'text-destructive-light';
  // Approximation: candle direction = bias proxy. Real buy/sell split needs
  // per-trade data which the candle endpoint doesn't carry.
  const directionLabel = isUp ? 'Buy-bias' : 'Sell-bias';

  // Distance of the hovered close from the live chain mid. Suppress when
  // mid isn't available (loading) or the move is sub-bp (visual noise).
  const closeDeltaPct =
    marketPrice && marketPrice > 0 && Number.isFinite(info.candle.close)
      ? ((info.candle.close - marketPrice) / marketPrice) * 100
      : null;
  const showDelta = closeDeltaPct !== null && Math.abs(closeDeltaPct) >= 0.05;

  return (
    <div
      // Top-left corner of the chart *canvas* (not the chart panel).
      // The drawing toolbar lives in its own column to the left of the
      // canvas — see chart.tsx — so this top-left is the canvas's
      // top-left, not the panel's. left-3 gives a little breathing
      // room from the toolbar's right border.
      className='pointer-events-none absolute top-2 left-3 z-30 min-w-[200px] rounded-sm border border-other-tonal-stroke bg-base-black/85 p-2.5 text-xs shadow-md backdrop-blur'
    >
      <div className='mb-1.5 text-text-secondary'>{formatTime(info.time)}</div>
      <div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums'>
        <span className='text-text-secondary'>Open</span>
        <span className='text-text-primary'>{formatPrice(info.candle.open)}</span>
        <span className='text-text-secondary'>High</span>
        <span className='text-text-primary'>{formatPrice(info.candle.high)}</span>
        <span className='text-text-secondary'>Low</span>
        <span className='text-text-primary'>{formatPrice(info.candle.low)}</span>
        <span className='text-text-secondary'>Close</span>
        <span className={directionColor}>{formatPrice(info.candle.close)}</span>
        {info.volume !== undefined && (
          <>
            <span className='text-text-secondary'>Volume</span>
            <span className='text-text-primary'>
              {formatVolume(info.volume)} {quoteSymbol}
            </span>
            <span className='text-text-secondary'>Bias</span>
            <span className={directionColor}>{directionLabel}</span>
          </>
        )}
        {showDelta && (
          <>
            <span className='text-text-secondary'>vs Mid</span>
            <span className='text-text-secondary'>
              {closeDeltaPct! > 0 ? '+' : ''}
              {closeDeltaPct!.toFixed(2)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
};

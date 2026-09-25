'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { balanceVisibility } from '@/shared/model/balance-visibility';

export interface ChartPoint {
  timeMs: number;
  usd: number;
}

const HEIGHT = 240;
const PAD = { top: 16, right: 64, bottom: 24, left: 8 };

const formatUsd = (n: number) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatAxis = (n: number) => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return n.toFixed(n < 10 ? 2 : 0);
};

const formatTime = (ms: number, spanMs: number) => {
  const d = new Date(ms);
  if (spanMs <= 2 * 86_400_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * Area chart of the wallet's USD value over time. Plain SVG: one series,
 * a hover crosshair, and axis labels that blur with the balance toggle.
 * The curve's shape stays (it carries no amounts), and hovering a point
 * shows its value, the same hover-to-reveal as every other hidden amount.
 */
export const BalanceChart = observer(({ points }: { points: ChartPoint[] }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | undefined>();
  const hidden = balanceVisibility.hidden;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || width === 0) {
      return undefined;
    }
    const t0 = first.timeMs;
    const span = Math.max(1, last.timeMs - t0);
    const max = Math.max(...points.map(p => p.usd));
    const min = Math.min(...points.map(p => p.usd));
    // Pad the value range so a flat line sits mid-chart rather than on an edge.
    const lo = max === min ? Math.max(0, min * 0.9) : Math.max(0, min - (max - min) * 0.1);
    const hi = max === min ? max * 1.1 || 1 : max + (max - min) * 0.1;
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (ms: number) => PAD.left + ((ms - t0) / span) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

    const line = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.timeMs).toFixed(1)},${y(p.usd).toFixed(1)}`)
      .join('');
    const area = `${line}L${x(last.timeMs).toFixed(1)},${PAD.top + plotH}L${x(t0).toFixed(1)},${PAD.top + plotH}Z`;
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => t0 + span * f);
    return { x, y, line, area, yTicks, xTicks, span, plotW, plotH };
  }, [points, width]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo || points.length === 0) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.timeMs) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hovered = hover !== undefined ? points[hover] : undefined;
  const blur = hidden ? 'blur-sm' : '';

  return (
    <div ref={wrapRef} className='relative w-full' style={{ height: HEIGHT }}>
      {geo && (
        <svg
          width={width}
          height={HEIGHT}
          className='text-primary-light'
          onPointerMove={onMove}
          onPointerLeave={() => setHover(undefined)}
        >
          <defs>
            <linearGradient id='balance-fill' x1='0' x2='0' y1='0' y2='1'>
              <stop offset='0%' stopColor='currentColor' stopOpacity={0.35} />
              <stop offset='100%' stopColor='currentColor' stopOpacity={0} />
            </linearGradient>
          </defs>

          {geo.yTicks.map(v => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={PAD.left + geo.plotW}
                y1={geo.y(v)}
                y2={geo.y(v)}
                stroke='currentColor'
                strokeOpacity={0.06}
              />
              <text
                x={width - 4}
                y={geo.y(v) + 4}
                textAnchor='end'
                className={`fill-text-secondary text-[10px] ${blur}`}
              >
                {formatAxis(v)}
              </text>
            </g>
          ))}
          {geo.xTicks.map(t => (
            <text
              key={t}
              x={geo.x(t)}
              y={HEIGHT - 6}
              textAnchor='middle'
              className='fill-text-secondary text-[10px]'
            >
              {formatTime(t, geo.span)}
            </text>
          ))}

          <path d={geo.area} fill='url(#balance-fill)' />
          <path d={geo.line} fill='none' stroke='currentColor' strokeWidth={1.5} />

          {hovered && (
            <g>
              <line
                x1={geo.x(hovered.timeMs)}
                x2={geo.x(hovered.timeMs)}
                y1={PAD.top}
                y2={PAD.top + geo.plotH}
                stroke='currentColor'
                strokeOpacity={0.3}
                strokeDasharray='3 3'
              />
              <circle
                cx={geo.x(hovered.timeMs)}
                cy={geo.y(hovered.usd)}
                r={4}
                fill='currentColor'
              />
            </g>
          )}
        </svg>
      )}

      {geo && hovered && (
        <div
          className='pointer-events-none absolute rounded-sm bg-other-tonal-fill10 px-2 py-1 text-xs text-text-primary backdrop-blur-md'
          style={{
            left: Math.min(Math.max(geo.x(hovered.timeMs) - 60, 0), width - 140),
            top: Math.max(geo.y(hovered.usd) - 48, 0),
          }}
        >
          <div className='text-text-secondary'>
            {new Date(hovered.timeMs).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
          {/* Hovering is the reveal gesture, so the tooltip is never blurred. */}
          <div className='font-mono'>{formatUsd(hovered.usd)} USD</div>
        </div>
      )}
    </div>
  );
});

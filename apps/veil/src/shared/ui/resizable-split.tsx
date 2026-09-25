'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import cn from 'clsx';

interface ResizableSplitProps {
  /**
   * Anchor side: the resized child has fixed width (or height); the other
   * fills the remaining space. We anchor on `right` for column splits so
   * the form panel keeps its size as the chart area grows.
   */
  anchor?: 'right' | 'bottom';
  /** Children: [stretching-side, anchored-side]. */
  children: [ReactNode, ReactNode];
  /** Default size of the anchored side in px (used until localStorage loads). */
  defaultSize: number;
  /** Min/max for the anchored side in px. */
  min: number;
  max: number;
  /** localStorage key for persisting the chosen size. */
  storageKey: string;
  /** Outer container class — usually pass through wrapper styling here. */
  className?: string;
}

const readStored = (key: string, fallback: number, min: number, max: number): number => {
  if (typeof window === 'undefined') {return fallback;}
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const ResizableSplit = ({
  anchor = 'right',
  children,
  defaultSize,
  min,
  max,
  storageKey,
  className,
}: ResizableSplitProps) => {
  const [size, setSize] = useState<number>(defaultSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHorizontal = anchor === 'right';

  useEffect(() => {
    setSize(readStored(storageKey, defaultSize, min, max));
  }, [storageKey, defaultSize, min, max]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) {return;}
    const rect = container.getBoundingClientRect();

    // pointermove fires 60-100×/s during a drag. Each setSize triggers a
    // flex-layout recalc of the whole panel + every child (chart, form,
    // tables — none of which can usefully redraw faster than once per
    // paint). rAF-coalesce so we reconcile at most once per frame, same
    // pattern as the chart's volume divider and the LP price slider.
    let pendingNext: number | null = null;
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      if (pendingNext === null) {return;}
      const next = pendingNext;
      pendingNext = null;
      setSize(Math.min(max, Math.max(min, next)));
    };

    const onMove = (ev: PointerEvent) => {
      pendingNext = isHorizontal ? rect.right - ev.clientX : rect.bottom - ev.clientY;
      if (rafId) {return;}
      rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Drain any pending rAF so the persisted size matches the cursor's
      // final position rather than landing a frame behind.
      if (rafId) {
        cancelAnimationFrame(rafId);
        flush();
      }
      // Persist the latest size by reading from the React state via setter.
      setSize(current => {
        try {
          window.localStorage.setItem(storageKey, String(current));
        } catch {
          // storage may be disabled; ignore
        }
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 min-w-0',
        isHorizontal ? 'flex-row' : 'flex-col',
        className,
      )}
    >
      <div className={cn('min-h-0 min-w-0', isHorizontal ? 'flex-1' : 'flex-1')}>
        {children[0]}
      </div>
      <div
        role='separator'
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        onPointerDown={onPointerDown}
        className={cn(
          'group relative shrink-0 transition-colors hover:bg-other-solid-stroke/40',
          isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        )}
        title={isHorizontal ? 'Drag to resize columns' : 'Drag to resize rows'}
      />
      <div
        className='shrink-0 overflow-hidden'
        style={isHorizontal ? { width: size } : { height: size }}
      >
        {children[1]}
      </div>
    </div>
  );
};

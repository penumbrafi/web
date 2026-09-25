'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Returns the direction of the most recent change to a numeric value:
 * 'up' if the latest update was higher than the previous, 'down' if
 * lower, 'flat' on first sample or when the value is undefined.
 *
 * Used to keep the chart's mid-price label, the document title ticker,
 * and the Summary 'Mid price' card all flashing the same colour on each
 * tick — without any of them having to track the previous value
 * themselves.
 */
export type TickDirection = 'up' | 'down' | 'flat';

/** Text colour token for the last tick (up green, down red, flat neutral). */
export const TICK_TEXT_COLOR = {
  up: 'success.light',
  down: 'destructive.light',
  flat: 'text.primary',
} as const satisfies Record<TickDirection, string>;

/** Arrow prefix for the last tick, including its trailing space. */
export const TICK_ARROW: Record<TickDirection, string> = { up: '▲ ', down: '▼ ', flat: '' };

export const useTickDirection = (value: number | undefined): TickDirection => {
  const [direction, setDirection] = useState<TickDirection>('flat');
  const prevRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value === undefined || !Number.isFinite(value)) {
      prevRef.current = undefined;
      setDirection('flat');
      return;
    }
    const prev = prevRef.current;
    if (prev !== undefined && prev !== value) {
      setDirection(value > prev ? 'up' : 'down');
    }
    prevRef.current = value;
  }, [value]);

  return direction;
};

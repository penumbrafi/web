/**
 * The chart's time axis. lightweight-charts spaces points by index, not by
 * time, so plotting the sparse change log directly would stretch a busy week
 * wider than a quiet year. Every series is resampled onto one evenly spaced
 * grid instead, and the chart gets the whole grid as its axis.
 */

const HOUR_MS = 3_600_000;
// Enough for hourly resolution over ~2.8 years; coarser steps beyond that.
const MAX_GRID_POINTS = 25_000;

/**
 * Evenly spaced times from `startMs` (floored to the step) up to `endMs`,
 * whose own time closes the grid so the latest change is always on it.
 * Whole seconds, strictly ascending.
 */
export const gridTimes = (startMs: number, endMs: number): number[] => {
  if (!(endMs > startMs)) {
    return [Math.floor(endMs / 1000) * 1000];
  }
  const stepMs = Math.max(
    HOUR_MS,
    Math.ceil((endMs - startMs) / MAX_GRID_POINTS / HOUR_MS) * HOUR_MS,
  );
  const out: number[] = [];
  for (let t = Math.floor(startMs / stepMs) * stepMs; t < endMs; t += stepMs) {
    out.push(t);
  }
  const end = Math.floor(endMs / 1000) * 1000;
  if (out.length === 0 || end > (out[out.length - 1] ?? 0)) {
    out.push(end);
  }
  return out;
};

/**
 * A step series (`[timeMs, value]`, ascending) read at each grid time: the
 * value of the last change at or before it. Grid times before the asset's
 * first non-zero value are undefined, not 0: on a % scale a zero first
 * value has no meaningful change from it, and "did not exist yet" isn't 0.
 */
export const stepOnGrid = (
  points: readonly (readonly [number, number])[],
  grid: readonly number[],
): (number | undefined)[] => {
  const start = points.findIndex(([, v]) => v !== 0);
  const out: (number | undefined)[] = [];
  if (start === -1) {
    return grid.map(() => undefined);
  }
  let i = start;
  let current: number | undefined;
  for (const t of grid) {
    while (i < points.length && (points[i]?.[0] ?? Infinity) <= t) {
      current = points[i]?.[1];
      i++;
    }
    out.push(current);
  }
  return out;
};

/**
 * Step-series helpers for the sparse change log in `insights_shielded_pool`.
 *
 * A row exists only at heights where the value changed, so a series is a
 * step function: the value at any time is the value of the latest point at
 * or before it. Everything here is pure and works on already-scaled floats;
 * BigInt scaling happens in `amount.ts` before the points are built.
 */

export interface Point {
  /** Unix ms of the block. */
  t: number;
  v: number;
}

/** Sort ascending by time and, for duplicate timestamps, keep the last value. */
export const normalizePoints = (points: readonly Point[]): Point[] => {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Point[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.t === p.t) {
      last.v = p.v;
    } else {
      out.push({ t: p.t, v: p.v });
    }
  }
  return out;
};

/** Value of the step function at time `t`, or null before the first point. */
export const valueAt = (points: readonly Point[], t: number): number | null => {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = points[mid];
    if (p && p.t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const p = points[found];
  return p ? p.v : null;
};

/**
 * Restrict a step series to `[from, to]` for drawing.
 *
 * - A synthetic point at `from` carries the last value before the range, so
 *   a 30-day window of an asset that has not changed in 60 days still draws
 *   its (flat) line instead of nothing.
 * - A synthetic point at `to` (normally the latest indexed block) carries the
 *   last value, so the final step reaches the right edge instead of stopping
 *   at the last change event.
 */
export const clipStep = (points: readonly Point[], from: number, to: number): Point[] => {
  const sorted = normalizePoints(points);
  if (sorted.length === 0 || to < from) {
    return [];
  }
  const inside = sorted.filter(p => p.t >= from && p.t <= to);
  const out: Point[] = [];
  const before = valueAt(sorted, from);
  const first = inside[0];
  if (before !== null && (!first || first.t > from)) {
    out.push({ t: from, v: before });
  }
  out.push(...inside);
  const last = out[out.length - 1];
  if (last && last.t < to) {
    out.push({ t: to, v: last.v });
  }
  return out;
};

/** Sorted union of the timestamps of several series. */
export const unionTimeline = (series: readonly (readonly Point[])[]): number[] => {
  const ts = new Set<number>();
  for (const s of series) {
    for (const p of s) {
      ts.add(p.t);
    }
  }
  return [...ts].sort((a, b) => a - b);
};

/**
 * Forward-fill a step series onto a shared timeline. Slots before the
 * series' first point are null (the asset did not exist yet), never zero:
 * zero is a real value that means "fully unshielded".
 */
export const forwardFillOnto = (
  points: readonly Point[],
  timeline: readonly number[],
): (number | null)[] => {
  const sorted = normalizePoints(points);
  const out: (number | null)[] = [];
  let i = 0;
  let current: number | null = null;
  for (const t of timeline) {
    while (i < sorted.length && (sorted[i]?.t ?? Infinity) <= t) {
      current = sorted[i]?.v ?? current;
      i += 1;
    }
    out.push(current);
  }
  return out;
};

/** Log axes cannot draw zero or negatives: those slots become gaps. */
export const logSafe = (v: number | null): number | null => (v !== null && v > 0 ? v : null);

/**
 * Index a filled series to 100 at its first non-null, non-zero value so
 * assets of wildly different magnitude share one axis.
 */
export const indexTo100 = (values: readonly (number | null)[]): (number | null)[] => {
  const base = values.find((v): v is number => v !== null && v !== 0);
  if (base === undefined) {
    return values.map(() => null);
  }
  return values.map(v => (v === null ? null : (v / base) * 100));
};

/**
 * Thin a dense series to at most `max` points by keeping every k-th point
 * plus the last one. Used for the per-block supply series after the SQL
 * downsample, so a multi-year "all" view stays a few hundred points.
 */
export const thin = (points: readonly Point[], max: number): Point[] => {
  if (points.length <= max || max < 2) {
    return [...points];
  }
  const stride = Math.ceil(points.length / (max - 1));
  const out = points.filter((_, i) => i % stride === 0);
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
};

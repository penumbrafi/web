import { describe, expect, it } from 'vitest';
import {
  clipStep,
  forwardFillOnto,
  indexTo100,
  logSafe,
  normalizePoints,
  thin,
  unionTimeline,
  valueAt,
  type Point,
} from './series';

const DAY = 86_400_000;

// A sparse change log: shielded at day 0, topped up day 10, drained day 40.
const sparse: Point[] = [
  { t: 0, v: 100 },
  { t: 10 * DAY, v: 250 },
  { t: 40 * DAY, v: 0 },
];

describe('normalizePoints', () => {
  it('sorts out-of-order rows and keeps the last value for a duplicate timestamp', () => {
    expect(
      normalizePoints([
        { t: 5, v: 2 },
        { t: 1, v: 1 },
        { t: 5, v: 3 },
      ]),
    ).toEqual([
      { t: 1, v: 1 },
      { t: 5, v: 3 },
    ]);
  });
});

describe('valueAt', () => {
  it('holds the last value until the next change (step semantics)', () => {
    expect(valueAt(sparse, -1)).toBeNull();
    expect(valueAt(sparse, 0)).toBe(100);
    expect(valueAt(sparse, 9 * DAY)).toBe(100);
    expect(valueAt(sparse, 10 * DAY)).toBe(250);
    expect(valueAt(sparse, 39 * DAY)).toBe(250);
    expect(valueAt(sparse, 1000 * DAY)).toBe(0);
  });
});

describe('clipStep', () => {
  it('prepends the carried value at the range start and extends the last step to the range end', () => {
    // 30-day window ending at day 60: the only change inside is none; the
    // value carried in is 0 (drained on day 40).
    expect(clipStep(sparse, 30 * DAY, 60 * DAY)).toEqual([
      { t: 30 * DAY, v: 250 },
      { t: 40 * DAY, v: 0 },
      { t: 60 * DAY, v: 0 },
    ]);
  });

  it('draws a flat line for a window with no change events at all', () => {
    expect(clipStep(sparse, 50 * DAY, 80 * DAY)).toEqual([
      { t: 50 * DAY, v: 0 },
      { t: 80 * DAY, v: 0 },
    ]);
  });

  it('does not invent a value before the first event', () => {
    expect(clipStep(sparse, -5 * DAY, 5 * DAY)).toEqual([
      { t: 0, v: 100 },
      { t: 5 * DAY, v: 100 },
    ]);
  });

  it('does not duplicate a point that already sits on the boundary', () => {
    expect(clipStep(sparse, 10 * DAY, 40 * DAY)).toEqual([
      { t: 10 * DAY, v: 250 },
      { t: 40 * DAY, v: 0 },
    ]);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(clipStep([], 0, DAY)).toEqual([]);
    expect(clipStep(sparse, DAY, 0)).toEqual([]);
  });
});

describe('forwardFillOnto', () => {
  it('fills the union timeline and keeps pre-existence as null, not zero', () => {
    const a: Point[] = [
      { t: 0, v: 1 },
      { t: 20, v: 3 },
    ];
    const b: Point[] = [
      { t: 10, v: 5 },
      { t: 30, v: 0 },
    ];
    const timeline = unionTimeline([a, b]);
    expect(timeline).toEqual([0, 10, 20, 30]);
    expect(forwardFillOnto(a, timeline)).toEqual([1, 1, 3, 3]);
    expect(forwardFillOnto(b, timeline)).toEqual([null, 5, 5, 0]);
  });
});

describe('logSafe / indexTo100', () => {
  it('turns zero into a gap for log axes', () => {
    expect([0, 5, null].map(logSafe)).toEqual([null, 5, null]);
  });

  it('indexes to the first non-zero value', () => {
    expect(indexTo100([null, 0, 50, 100])).toEqual([null, 0, 100, 200]);
    expect(indexTo100([null, 0])).toEqual([null, null]);
  });
});

describe('thin', () => {
  it('keeps the first and last points and at most max', () => {
    const dense = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i }));
    const out = thin(dense, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0]).toEqual({ t: 0, v: 0 });
    expect(out[out.length - 1]).toEqual({ t: 999, v: 999 });
  });

  it('is the identity below the cap', () => {
    expect(thin(sparse, 10)).toEqual(sparse);
  });
});

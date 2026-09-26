import { describe, expect, it } from 'vitest';
import { dailyTimes, stateAt, topAndOther } from './overview-lib';

const D = 86_400_000;
const e = (timeMs: number, current: number, total = current, depositors = 1) => ({
  timeMs,
  current,
  total,
  depositors,
});

describe('stateAt', () => {
  const entries = [e(10, 5), e(20, 3, 8, 2), e(30, 9, 14, 3)];

  it('is zero before the first change', () => {
    expect(stateAt(entries, 9)).toEqual({ current: 0, total: 0, depositors: 0 });
  });

  it('holds the last change at or before the time', () => {
    expect(stateAt(entries, 20)).toEqual({ current: 3, total: 8, depositors: 2 });
    expect(stateAt(entries, 29)).toEqual({ current: 3, total: 8, depositors: 2 });
    expect(stateAt(entries, 1e12)).toEqual({ current: 9, total: 14, depositors: 3 });
  });
});

describe('dailyTimes', () => {
  it('starts at the UTC midnight of the first day and ends on the end time', () => {
    expect(dailyTimes(D + 5, 3 * D + 7)).toEqual([D, 2 * D, 3 * D, 3 * D + 7]);
  });
});

describe('topAndOther', () => {
  it('keeps the n largest by last value and sums the rest', () => {
    const series = new Map([
      ['a', [1, 1]],
      ['b', [5, 9]],
      ['c', [2, 3]],
      ['d', [4, 2]],
    ]);
    expect(topAndOther(series, 2, 2)).toEqual({
      stack: [
        { assetId: 'b', usd: [5, 9] },
        { assetId: 'c', usd: [2, 3] },
      ],
      otherUsd: [5, 3],
    });
  });
});

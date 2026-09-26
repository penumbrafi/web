import { describe, expect, it } from 'vitest';
import { gridTimes, stepOnGrid } from './grid';

const H = 3_600_000;

describe('gridTimes', () => {
  it('is hourly from the floored start and closes on the end time', () => {
    expect(gridTimes(10 * H + 5, 12 * H + 1500)).toEqual([10 * H, 11 * H, 12 * H, 12 * H + 1000]);
  });

  it('does not repeat the end when it lands on the grid', () => {
    expect(gridTimes(0, 2 * H)).toEqual([0, H, 2 * H]);
  });

  it('coarsens the step so long spans stay bounded', () => {
    const grid = gridTimes(0, 5 * 365 * 24 * H);
    expect(grid.length).toBeLessThanOrEqual(25_001);
    expect((grid[1] ?? 0) - (grid[0] ?? 0)).toBe(2 * H);
  });

  it('is strictly ascending', () => {
    const grid = gridTimes(1_700_000_123_456, 1_700_900_000_789);
    expect(grid.every((t, i) => i === 0 || t > (grid[i - 1] ?? Infinity))).toBe(true);
  });
});

describe('stepOnGrid', () => {
  it('carries the last change forward and is undefined before the first', () => {
    const points = [
      [2 * H + 10, 5],
      [2 * H + 20, 7],
      [4 * H, 3],
    ] as const;
    expect(stepOnGrid(points, [H, 2 * H, 3 * H, 4 * H, 5 * H])).toEqual([
      undefined,
      undefined,
      7,
      3,
      3,
    ]);
  });

  it('skips leading zeros but keeps later ones', () => {
    const points = [
      [H, 0],
      [2 * H, 4],
      [3 * H, 0],
    ] as const;
    expect(stepOnGrid(points, [H, 2 * H, 3 * H])).toEqual([undefined, 4, 0]);
  });

  it('is all undefined for an asset that was never non-zero', () => {
    expect(stepOnGrid([[H, 0]], [H, 2 * H])).toEqual([undefined, undefined]);
  });
});

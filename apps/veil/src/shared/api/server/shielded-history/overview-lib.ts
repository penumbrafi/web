/**
 * Pure helpers for the shielded-pool overview. No I/O, so they are unit
 * tested directly; `overview.ts` feeds them pindexer rows.
 */

const DAY_MS = 86_400_000;

/** One change-log entry: the state after a change, at its block time. */
export interface TimedEntry {
  timeMs: number;
  current: number;
  total: number;
  depositors: number;
}

const ZERO = { current: 0, total: 0, depositors: 0 };

/** State at `t`: the last entry at or before it, or all zero before the first. */
export const stateAt = (
  entries: readonly TimedEntry[],
  t: number,
): { current: number; total: number; depositors: number } => {
  let lo = 0;
  let hi = entries.length - 1;
  let found: TimedEntry | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const e = entries[mid];
    if (e && e.timeMs <= t) {
      found = e;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found
    ? { current: found.current, total: found.total, depositors: found.depositors }
    : ZERO;
};

/** UTC midnights from the day of `startMs` up to `endMs`, then `endMs` itself. */
export const dailyTimes = (startMs: number, endMs: number): number[] => {
  const out: number[] = [];
  for (let t = Math.floor(startMs / DAY_MS) * DAY_MS; t < endMs; t += DAY_MS) {
    out.push(t);
  }
  out.push(endMs);
  return out;
};

/**
 * Split per-asset USD series into the `n` largest by their last value and
 * the sum of the rest, so a stacked chart stays readable.
 */
export const topAndOther = (
  series: ReadonlyMap<string, number[]>,
  n: number,
  length: number,
): { stack: { assetId: string; usd: number[] }[]; otherUsd: number[] } => {
  const ranked = [...series.entries()].sort(
    (a, b) => (b[1][length - 1] ?? 0) - (a[1][length - 1] ?? 0),
  );
  const otherUsd = new Array<number>(length).fill(0);
  for (const [, usd] of ranked.slice(n)) {
    usd.forEach((v, i) => {
      otherUsd[i] = (otherUsd[i] ?? 0) + v;
    });
  }
  return {
    stack: ranked.slice(0, n).map(([assetId, usd]) => ({ assetId, usd })),
    otherUsd,
  };
};

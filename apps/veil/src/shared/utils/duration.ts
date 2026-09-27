export const durationWindows = ['1b', '1m', '15m', '1h', '4h', '1d', '1w', '1mo'] as const;
export type DurationWindow = (typeof durationWindows)[number];

/**
 * `1b` is one chain block: ~6s, but not a fixed duration, so it cannot be
 * stepped by a calendar increment. Every helper that walks a bucket grid
 * (gap/tail fill) takes a `WallClockWindow` instead, which keeps `1b` out of
 * the wall-clock code path at the type level. Block candles are keyed by
 * height and their time comes from the block header, so there is normally
 * nothing to step: an idle block simply has no candle.
 */
export type WallClockWindow = Exclude<DurationWindow, '1b'>;

export const isDurationWindow = (str: string): str is DurationWindow =>
  durationWindows.includes(str as DurationWindow);

export const addDurationWindow = (window: WallClockWindow, to: Date): Date => {
  const out = new Date(to);
  switch (window) {
    case '1m':
      out.setMinutes(to.getMinutes() + 1);
      break;
    case '15m':
      out.setMinutes(to.getMinutes() + 15);
      break;
    case '1h':
      out.setHours(to.getHours() + 1);
      break;
    case '4h':
      out.setHours(to.getHours() + 4);
      break;
    case '1d':
      out.setDate(to.getDate() + 1);
      break;
    case '1w':
      out.setDate(to.getDate() + 7);
      break;
    case '1mo':
      out.setMonth(to.getMonth() + 1);
      break;
  }
  return out;
};

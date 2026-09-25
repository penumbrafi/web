const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const small = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });

/** Axis ticks and stat tiles: 1.2M, 34.5K, 0.0021. */
export const formatCompact = (v: number): string => {
  if (!Number.isFinite(v)) {
    return '-';
  }
  if (v !== 0 && Math.abs(v) < 1) {
    return small.format(v);
  }
  return compact.format(v);
};

/** Table cells and tooltips: full precision to two decimals. */
export const formatAmount = (v: number): string => {
  if (!Number.isFinite(v)) {
    return '-';
  }
  if (v !== 0 && Math.abs(v) < 0.01) {
    return small.format(v);
  }
  return full.format(v);
};

export const formatInt = (v: number): string => new Intl.NumberFormat('en-US').format(v);

const dateOnly = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const monthYear = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  year: '2-digit',
});
const monthDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

export const formatDate = (ms: number): string => dateOnly.format(new Date(ms));
export const formatDateTime = (ms: number): string => `${dateTime.format(new Date(ms))} UTC`;

/** Axis tick: month+day inside a window under a year, month+year beyond. */
export const formatTick = (ms: number, spanMs: number): string =>
  spanMs > 400 * 86_400_000 ? monthYear.format(new Date(ms)) : monthDay.format(new Date(ms));

/** Shorten a base64 asset id for table cells: first 8 chars + ellipsis. */
export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

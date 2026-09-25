'use client';

// Small window picker shared by the supply/inflation charts. `all` returns
// the full series unchanged; `1y` slices to the trailing 365d;
// `30d` slices to the trailing 30d. Server sends a wide window
// (~800d) once per page render, panels filter it client-side so
// switching doesn't hit the server.

export type Window = '30d' | '1y' | 'all';

export const WINDOWS: { value: Window; label: string; days: number | null }[] = [
  { value: '30d', label: '30d', days: 30 },
  { value: '1y', label: '1y', days: 365 },
  { value: 'all', label: 'All', days: null },
];

// Slice an ISO-date-keyed series to the trailing `days` days.
// `days === null` returns the input untouched.
export const sliceByWindow = <T extends { date: string }>(
  rows: T[],
  days: number | null,
): T[] => {
  if (days === null) {return rows;}
  const cutoff = Date.now() - days * 86_400 * 1000;
  return rows.filter(r => Date.parse(r.date) >= cutoff);
};

export const WindowSelect = ({
  value,
  onChange,
}: {
  value: Window;
  onChange: (w: Window) => void;
}) => (
  <div className='inline-flex gap-1 rounded-sm bg-other-tonal-fill5 p-0.5 text-[11px] tabular-nums'>
    {WINDOWS.map(w => (
      <button
        key={w.value}
        type='button'
        onClick={() => onChange(w.value)}
        className={
          'rounded-sm px-2 py-0.5 transition-colors' +
          (w.value === value
            ? 'bg-primary-main text-base-black'
            : 'text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary')
        }
      >
        {w.label}
      </button>
    ))}
  </div>
);

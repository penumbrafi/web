'use client';

import clsx from 'clsx';

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A row of radio-like buttons: range presets, scale toggles. */
export const Segmented = <T extends string>({ label, value, options, onChange }: Props<T>) => (
  <div
    role='radiogroup'
    aria-label={label}
    className='flex rounded-xs border border-other-tonal-stroke text-xs'
  >
    {options.map(o => (
      <button
        key={o.value}
        type='button'
        role='radio'
        aria-checked={o.value === value}
        onClick={() => {
          onChange(o.value);
        }}
        className={clsx(
          'px-2.5 py-1 transition-colors first:rounded-l-xs last:rounded-r-xs',
          o.value === value
            ? 'bg-other-tonal-fill10 text-text-primary'
            : 'text-text-secondary hover:bg-other-tonal-fill5 hover:text-text-primary',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

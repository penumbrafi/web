'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, Check } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import type { ChartPrefs } from './use-chart-prefs';

interface ToggleSpec {
  key: keyof ChartPrefs;
  label: string;
  hint?: string;
  /** Disable the row when the underlying feature can't render yet (e.g. wallet not connected). */
  disabled?: boolean;
}

interface Props {
  prefs: ChartPrefs;
  onToggle: (key: keyof ChartPrefs) => void;
  /** Pass `true` for keys that depend on a connected wallet — they're
   *  greyed out until the user connects so the menu doesn't lie. */
  walletConnected: boolean;
}

const SPECS: Omit<ToggleSpec, 'disabled'>[] = [
  {
    key: 'midPrice',
    label: 'Mid-price line',
    hint: 'Live mid of the on-chain route book, drawn across the candles.',
  },
  {
    key: 'depth',
    label: 'Order book depth',
    hint: 'Live route-book depth as a heatmap on the chart edge.',
  },
  {
    key: 'ownPositions',
    label: 'My LP positions',
    hint: 'Horizontal lines for each open LP price you own.',
  },
  {
    key: 'linesSizeByAmount',
    label: 'Size-proportional LP lines',
    hint: 'Line width reflects the position size on this pair — bigger orders read as thicker lines.',
  },
  {
    key: 'linesShowAmount',
    label: 'Amount in LP line label',
    hint: 'Suffix the price-scale label with the position amount (base for asks, quote for bids).',
  },
  {
    key: 'ownTrades',
    label: 'My recent fills',
    hint: 'A dot at the executed price of each swap you submitted on this pair.',
  },
  {
    key: 'openOrders',
    label: 'My open limit orders',
    hint: 'Resting limit orders, with × to cancel inline. Coming soon.',
  },
  {
    key: 'closeLine',
    label: 'Close-price line',
    hint: 'Line through candle closes. Keeps the price visible when candles collapse to a 1-pixel doji on flat periods.',
  },
];

// memo'd because the chart re-renders on every block-tick via marketPrice,
// but this menu's three props (`prefs` state, `onToggle` useCallback,
// `walletConnected` boolean) are stable across those renders. Without
// memo the SPECS.map() below would re-allocate five fresh ToggleSpec
// objects every block — cheap individually but pure waste on a closed
// menu the user only opens once a session.
export const ChartSettingsMenu = memo(({ prefs, onToggle, walletConnected }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = useCallback(() => setOpen(o => !o), []);

  // openOrders is not implemented yet — placeholder. Wallet-gated overlays
  // grey out until the user connects so the menu doesn't lie. Memoize on
  // [walletConnected] so the disabled-flag computation runs once per
  // connection-state change, not on every parent re-render.
  const specs = useMemo<ToggleSpec[]>(
    () =>
      SPECS.map(s => ({
        ...s,
        disabled:
          s.key === 'openOrders' ||
          ((s.key === 'ownPositions' ||
            s.key === 'ownTrades' ||
            s.key === 'linesSizeByAmount' ||
            s.key === 'linesShowAmount') &&
            !walletConnected),
      })),
    [walletConnected],
  );

  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        aria-label='Chart overlays'
        onClick={toggleOpen}
        className='flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-action-hover-overlay hover:text-text-primary'
      >
        <Settings2 className='h-4 w-4' />
      </button>

      {open && (
        <div
          className='absolute right-0 z-30 mt-1 w-[260px] rounded-md border border-other-tonal-stroke bg-base-black p-2 shadow-lg backdrop-blur-lg'
          role='menu'
        >
          <Text detail color='text.secondary' as='div' >
            <span className='block px-2 py-1'>Chart overlays</span>
          </Text>
          {specs.map(spec => {
            const checked = prefs[spec.key];
            return (
              <button
                key={spec.key}
                type='button'
                disabled={spec.disabled && !checked}
                onClick={() => onToggle(spec.key)}
                className={[
                  'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors',
                  spec.disabled && !checked
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:bg-action-hover-overlay',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                    checked
                      ? 'border-primary-main bg-primary-main text-base-black'
                      : 'border-other-tonal-stroke',
                  ].join(' ')}
                >
                  {checked && <Check className='h-3 w-3' />}
                </span>
                <span className='flex flex-col gap-0.5'>
                  <Text small color='text.primary'>
                    {spec.label}
                  </Text>
                  {spec.hint && (
                    <Text detail color='text.secondary'>
                      {spec.hint}
                    </Text>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

ChartSettingsMenu.displayName = 'ChartSettingsMenu';

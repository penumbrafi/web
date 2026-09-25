'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, X, Check } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import type { AlertDirection, PriceAlert } from './use-price-alerts';

type NotificationPermission = 'default' | 'granted' | 'denied';

const getPermission = (): NotificationPermission => {
  if (typeof window === 'undefined' || !('Notification' in window)) {return 'denied';}
  return Notification.permission as NotificationPermission;
};

const requestPermission = async (): Promise<NotificationPermission> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {return 'denied';}
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermission;
  } catch {
    return 'denied';
  }
};

interface Props {
  pair: string;
  marketPrice?: number;
  alerts: PriceAlert[];
  onAdd: (a: Omit<PriceAlert, 'id' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
}

export const AlertsMenu = ({ pair, marketPrice, alerts, onAdd, onRemove }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Form state
  const [target, setTarget] = useState('');
  const [direction, setDirection] = useState<AlertDirection>('above');
  const [browser, setBrowser] = useState(true);
  const [ntfy, setNtfy] = useState('');
  const [perm, setPerm] = useState<NotificationPermission>('default');

  useEffect(() => {
    setPerm(getPermission());
  }, [open]);

  useEffect(() => {
    if (!open) {return;}
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {setOpen(false);}
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {setOpen(false);}
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Default the target field to the current mid price when the menu
  // opens — saves the user typing it themselves.
  useEffect(() => {
    if (open && !target && marketPrice != null) {
      setTarget(marketPrice.toPrecision(6));
    }
  }, [open, marketPrice, target]);

  // Default direction to "above" if mid is below the target the user
  // is typing, else "below" — guess the more common intent.
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = parseFloat(target);
    if (!Number.isFinite(t) || t <= 0) {return;}

    let perm2 = perm;
    if (browser && perm !== 'granted') {
      perm2 = await requestPermission();
      setPerm(perm2);
    }

    onAdd({
      pair,
      targetPrice: t,
      direction,
      browser: browser && perm2 === 'granted',
      ntfyTopic: ntfy.trim(),
    });

    setTarget('');
    setNtfy('');
  };

  // Active alerts (not yet triggered) for the active pair.
  const active = alerts.filter(a => !a.triggeredAt);
  const recent = alerts.filter(a => !!a.triggeredAt).slice(-3);

  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        aria-label='Price alerts'
        onClick={() => setOpen(o => !o)}
        className='relative flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-action-hover-overlay hover:text-text-primary'
      >
        <Bell className='h-4 w-4' />
        {active.length > 0 && (
          <span className='absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary-main px-1 text-[9px] font-medium text-base-black'>
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className='absolute right-0 z-30 mt-1 w-[300px] rounded-md border border-other-tonal-stroke bg-base-black p-3 shadow-lg backdrop-blur-lg'
          role='menu'
        >
          <Text detail color='text.secondary'>
            <span className='block px-1 pb-2'>
              Price alerts · {pair}
              {marketPrice != null && (
                <span className='ml-1 text-text-primary tabular-nums'>
                  · Mid {marketPrice.toPrecision(6)}
                </span>
              )}
            </span>
          </Text>

          <form onSubmit={onSubmit} className='flex flex-col gap-2'>
            <div className='flex gap-2'>
              <select
                value={direction}
                onChange={e => setDirection(e.target.value as AlertDirection)}
                className='rounded bg-other-tonal-fill5 px-2 py-1 text-sm text-text-primary outline-none focus:bg-other-tonal-fill10'
              >
                <option value='above'>Above</option>
                <option value='below'>Below</option>
              </select>
              <input
                type='number'
                value={target}
                step='any'
                placeholder='Target price'
                onChange={e => setTarget(e.target.value)}
                className='flex-1 rounded bg-other-tonal-fill5 px-2 py-1 text-sm text-text-primary outline-none focus:bg-other-tonal-fill10'
              />
            </div>

            <label className='flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-action-hover-overlay'>
              <input
                type='checkbox'
                checked={browser}
                onChange={e => setBrowser(e.target.checked)}
                className='mt-1'
              />
              <span className='flex flex-col gap-0.5'>
                <Text small color='text.primary'>
                  Browser notification
                </Text>
                <Text detail color='text.secondary'>
                  {perm === 'granted'
                    ? 'Permission granted.'
                    : perm === 'denied'
                      ? 'Permission denied — re-enable from browser settings.'
                      : 'You will be asked for permission on save.'}
                </Text>
              </span>
            </label>

            <label className='flex flex-col gap-1 px-1'>
              <Text detail color='text.secondary'>
                ntfy.sh topic <span className='opacity-60'>(optional)</span>
              </Text>
              <input
                type='text'
                value={ntfy}
                placeholder='e.g. my-um-alerts'
                onChange={e => setNtfy(e.target.value)}
                className='rounded bg-other-tonal-fill5 px-2 py-1 text-sm text-text-primary outline-none focus:bg-other-tonal-fill10'
              />
              <Text detail color='text.secondary'>
                Subscribe at ntfy.sh/&lt;topic&gt; on phone/desktop.
              </Text>
            </label>

            <button
              type='submit'
              className='mt-1 rounded bg-primary-main px-2 py-1 text-sm font-medium text-base-black transition-colors hover:bg-primary-light'
            >
              Save alert
            </button>
          </form>

          {active.length > 0 && (
            <div className='mt-3 border-t border-t-other-tonal-stroke pt-2'>
              <Text detail color='text.secondary'>
                <span className='block px-1 pb-1'>Active</span>
              </Text>
              <ul className='flex flex-col gap-1'>
                {active.map(a => {
                  // % distance from current mid. Positive means target sits
                  // above mid (waiting for a rally), negative below (waiting
                  // for a drop). A small visible cue of how 'live' each
                  // alert is — at 0.05% the alert is essentially at mid; at
                  // 30% the trader probably forgot they set it.
                  const deltaPct =
                    marketPrice != null && marketPrice > 0
                      ? ((a.targetPrice - marketPrice) / marketPrice) * 100
                      : null;
                  return (
                    <li
                      key={a.id}
                      className='flex items-center justify-between rounded px-1 py-1 hover:bg-action-hover-overlay'
                    >
                      <Text small color='text.primary'>
                        {a.direction} {a.targetPrice}
                        {deltaPct !== null && (
                          <span className='ml-1 text-text-secondary tabular-nums'>
                            ({deltaPct > 0 ? '+' : ''}
                            {deltaPct.toFixed(2)}%)
                          </span>
                        )}
                        {a.ntfyTopic && (
                          <span className='ml-1 text-text-secondary'>· ntfy:{a.ntfyTopic}</span>
                        )}
                      </Text>
                      <button
                        type='button'
                        aria-label='Remove alert'
                        onClick={() => onRemove(a.id)}
                        className='rounded p-0.5 text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary'
                      >
                        <X className='h-3.5 w-3.5' />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {recent.length > 0 && (
            <div className='mt-3 border-t border-t-other-tonal-stroke pt-2'>
              <Text detail color='text.secondary'>
                <span className='block px-1 pb-1'>Recently fired</span>
              </Text>
              <ul className='flex flex-col gap-1'>
                {recent.map(a => (
                  <li
                    key={a.id}
                    className='flex items-center justify-between rounded px-1 py-1'
                  >
                    <span className='inline-flex items-center gap-1'>
                      <Check className='h-3 w-3 text-success-light' />
                      <Text small color='text.secondary'>
                        {a.direction} {a.targetPrice}
                      </Text>
                    </span>
                    <button
                      type='button'
                      aria-label='Clear'
                      onClick={() => onRemove(a.id)}
                      className='rounded p-0.5 text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary'
                    >
                      <X className='h-3.5 w-3.5' />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

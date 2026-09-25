'use client';

import { useEffect, useRef } from 'react';
import type { PriceAlert } from './use-price-alerts';

interface Args {
  /** Live mid price for the active pair, or undefined while loading. */
  marketPrice: number | undefined;
  /** All alerts in localStorage — watcher self-filters by triggeredAt. */
  alerts: PriceAlert[];
  /** Called when an alert fires. Caller persists the triggeredAt. */
  onFire: (id: string) => void;
}

/**
 * Subscribes to mid-price ticks and fires alerts whose target was just
 * crossed. Crossing is detected against the *previous* mid price, so
 * arming an alert at a price the market is already past won't fire
 * spuriously — it only fires on the actual transition.
 *
 * Browser delivery uses the standard Notification API and assumes the
 * caller has already requested permission (we surface a button on the
 * menu form for that). Ntfy delivery posts plain-text bodies to
 * https://ntfy.sh/<topic> with Title/Priority/Tags headers — public
 * ntfy is auth-free for non-protected topics.
 */
export const useAlertWatcher = ({ marketPrice, alerts, onFire }: Args) => {
  const prevPriceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window === 'undefined') {return;}
    const prev = prevPriceRef.current;
    const curr = marketPrice;
    prevPriceRef.current = curr;

    if (prev === undefined || curr === undefined) {return;}
    if (prev === curr) {return;}

    for (const alert of alerts) {
      if (alert.triggeredAt) {continue;}
      const t = alert.targetPrice;
      const crossed =
        alert.direction === 'above'
          ? prev < t && curr >= t
          : prev > t && curr <= t;
      if (!crossed) {continue;}
      void deliver(alert, curr);
      onFire(alert.id);
    }
  }, [marketPrice, alerts, onFire]);
};

const deliver = async (alert: PriceAlert, curr: number) => {
  const title = `${alert.pair} ${alert.direction} ${alert.targetPrice}`;
  const body = `Mid price is now ${curr.toFixed(6)}`;

  if (alert.browser) {
    try {
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification(title, { body, tag: alert.id });
      }
    } catch {
      // permission revoked between request and delivery — silently drop
    }
  }

  const topic = alert.ntfyTopic.trim();
  if (topic) {
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        body,
        headers: {
          Title: title,
          Tags: 'chart_with_upwards_trend',
          Priority: 'default',
        },
      });
    } catch {
      // ntfy unreachable / rate-limited — non-fatal
    }
  }
};

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type AlertDirection = 'above' | 'below';

export interface PriceAlert {
  id: string;
  pair: string; // 'UM/USDC'
  targetPrice: number;
  direction: AlertDirection;
  /** Send to navigator.notifications when fired. */
  browser: boolean;
  /** Send POST to ntfy.sh/<topic> when fired. Empty = disabled. */
  ntfyTopic: string;
  createdAt: number;
  /** When the alert fired. After this is set the alert is no longer active. */
  triggeredAt?: number;
}

const STORAGE_KEY = 'veil_price_alerts';

const read = (): PriceAlert[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PriceAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (alerts: PriceAlert[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // ignore storage errors
  }
};

/**
 * In-tab alerts CRUD with localStorage backing. Other tabs in the same
 * origin pick up changes via the `storage` event so the alerts list
 * stays consistent across windows. Fired alerts persist (with
 * triggeredAt) so a recently-fired alert is visible in the menu before
 * the user clears it — sturdier UX than silently disappearing.
 */
export const usePriceAlerts = (pair?: string) => {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  useEffect(() => {
    setAlerts(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setAlerts(read());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((a: Omit<PriceAlert, 'id' | 'createdAt'>) => {
    const next: PriceAlert = {
      ...a,
      id: `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      createdAt: Date.now(),
    };
    setAlerts(prev => {
      const merged = [...prev, next];
      write(merged);
      return merged;
    });
    return next;
  }, []);

  const remove = useCallback((id: string) => {
    setAlerts(prev => {
      const merged = prev.filter(a => a.id !== id);
      write(merged);
      return merged;
    });
  }, []);

  const markTriggered = useCallback((id: string) => {
    setAlerts(prev => {
      const merged = prev.map(a => (a.id === id ? { ...a, triggeredAt: Date.now() } : a));
      write(merged);
      return merged;
    });
  }, []);

  // Subset filter for the active pair when caller provides one — handy
  // for the chart toolbar which only cares about the current pair's
  // alerts in the menu. Memoize on [alerts, pair] so consumers (e.g.
  // useAlertWatcher) get a stable array reference when nothing changed
  // — without this, the previous form returned a fresh filter() result
  // every render and any useEffect dep on `alerts` re-fired on every
  // block-tick re-render of the chart.
  const visible = useMemo(
    () => (pair ? alerts.filter(a => a.pair === pair) : alerts),
    [alerts, pair],
  );

  return { alerts: visible, allAlerts: alerts, add, remove, markTriggered };
};

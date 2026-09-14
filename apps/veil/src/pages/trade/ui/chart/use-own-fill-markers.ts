'use client';

import { useEffect } from 'react';
import { connectionStore } from '@/shared/model/connection';
import { useLatestSwaps } from '../../api/latest-swaps';
import type { OwnFillMarker } from './use-chart-config';

/**
 * Pulls the user's recent swap fills on the active pair (via the view
 * service + pindexer reconciliation in useLatestSwaps) and pushes them
 * into the chart as time/price markers. Empty array clears markers when
 * the user disconnects or the pair changes.
 *
 * Must be called inside an `observer`-wrapped component so the
 * connectionStore reads below track on disconnect/account-switch.
 */
export const useOwnFillMarkers = (
  setMarkers: (markers: OwnFillMarker[]) => void,
): void => {
  const { connected, subaccount } = connectionStore;
  const { data: fills } = useLatestSwaps(subaccount);

  useEffect(() => {
    if (!connected || !fills?.length) {
      setMarkers([]);
      return;
    }
    const markers: OwnFillMarker[] = fills
      .map(f => {
        const t = Date.parse(f.timestamp);
        const price = Number(f.price);
        if (!Number.isFinite(t) || !Number.isFinite(price)) return null;
        return {
          time: Math.floor(t / 1000),
          price,
          direction: f.kind,
          // Colour already tells the direction (green = buy, red = sell);
          // dropping the arrow character out of the label keeps the
          // marker readable without echoing the same signal twice.
          label: `${f.amount}`,
        } satisfies OwnFillMarker;
      })
      .filter((m): m is OwnFillMarker => m !== null);
    setMarkers(markers);
  }, [connected, fills, setMarkers]);
};

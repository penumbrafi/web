import { useEffect } from 'react';
import { autorun } from 'mobx';
import { observer } from 'mobx-react-lite';
import { pnum } from '@penumbra-zone/types/pnum';
import { PositionState_PositionStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { connectionStore } from '@/shared/model/connection';
import { usePositions } from '@/entities/position/api/use-positions';
import { getDisplayPositions } from '@/entities/position/model/get-display-positions';
import { useGetMetadata } from '@/shared/api/assets';
import { usePathToMetadata } from '../../model/use-path';
import type { OwnPositionLine } from './use-chart-config';
import { ownPositionDragOverrides } from './drag-overrides';

/**
 * Reads user's OPEN positions for the current trading pair and pushes
 * horizontal price lines to the candle chart via setOwnPositionLines.
 *
 * Each side of a two-sided LP becomes its own line (one buy, one sell).
 * One-sided positions render a single line in the implied direction.
 */
export const useOwnPositionLines = (
  setLines: (lines: OwnPositionLine[]) => void,
): void => {
  const { connected, subaccount } = connectionStore;
  const { baseAsset, quoteAsset } = usePathToMetadata();
  const getMetadata = useGetMetadata();

  const { data: positionsPages } = usePositions(subaccount, [
    PositionState_PositionStateEnum.OPENED,
  ]);

  useEffect(() => {
    // Wrap the line rebuild in a mobx `autorun` so it re-fires whenever
    // `ownPositionDragOverrides` changes (drag start / move / drop).
    // React-query's `positionsPages` isn't observable, so it lives in the
    // outer effect deps — a fresh page of positions destroys the old
    // autorun and creates a new one with the new closure.
    const dispose = autorun(() => {
      if (!connected || !baseAsset || !quoteAsset || !positionsPages?.pages.length) {
        setLines([]);
        return;
      }
      const display = getDisplayPositions({
        positions: positionsPages.pages,
        getMetadata,
        asset1Filter: baseAsset,
        asset2Filter: quoteAsset,
      });

      const lines: OwnPositionLine[] = [];
      for (const dp of display) {
        if (!dp.isOpened) continue;
        for (let i = 0; i < dp.orders.length; i++) {
          const o = dp.orders[i]!;
          const key = `${dp.idString}-${i}`;
          // If the user is dragging this rung right now, paint the OG
          // line at the pointer-mapped price. Cleared on drop by the
          // drag overlay.
          const override = ownPositionDragOverrides.get(key);
          const price = override ?? pnum(o.effectivePrice).toNumber();
          if (!Number.isFinite(price) || price <= 0) continue;
          const direction = o.direction.toLowerCase();
          lines.push({
            id: key,
            price,
            direction: direction === 'buy' ? 'buy' : direction === 'sell' ? 'sell' : '',
            label: direction ? direction.toUpperCase() : 'LP',
          });
        }
      }
      setLines(lines);
    });
    return dispose;
  }, [
    connected,
    positionsPages,
    baseAsset,
    quoteAsset,
    getMetadata,
    setLines,
  ]);
};

// Mark as observer-friendly so connectionStore changes propagate.
export const observeOwnPositionLines = observer;

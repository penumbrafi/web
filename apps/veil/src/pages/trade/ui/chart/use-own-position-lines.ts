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
import type { ChartPrefs } from './use-chart-prefs';
import { ownPositionDragOverrides } from './drag-overrides';

// Compact amount format for the axis-label suffix — mirrors
// lp-preview-overlay's formatRungAmount so the live lines read the same
// way the LP draft preview already does. Kilos beyond 1000 with a 'k'
// suffix; more decimals as the value shrinks so small dust amounts don't
// all collapse to the same string.
const formatShortAmount = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) {
    return '0';
  }
  if (v >= 1000) {
    return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  }
  if (v >= 100) {
    return v.toFixed(0);
  }
  if (v >= 10) {
    return v.toFixed(1);
  }
  if (v >= 1) {
    return v.toFixed(2);
  }
  if (v >= 0.01) {
    return v.toFixed(3);
  }
  return v.toPrecision(2);
};

// Ratio-of-max thresholds for the 1/2/4px line-width spread. Ratio-based
// (not absolute-amount-based) so a whale pair and a dust pair both get
// the same visual spread — only relative size within THIS pair's open
// own-positions matters.
const BIG_RATIO = 2 / 3;
const MEDIUM_RATIO = 1 / 3;

/**
 * Reads user's OPEN positions for the current trading pair and pushes
 * horizontal price lines to the candle chart via setOwnPositionLines.
 *
 * Each side of a two-sided LP becomes its own line (one buy, one sell).
 * One-sided positions render a single line in the implied direction.
 */
export const useOwnPositionLines = (
  setLines: (lines: OwnPositionLine[]) => void,
  prefs: Pick<ChartPrefs, 'linesSizeByAmount' | 'linesShowAmount'>,
): void => {
  const { connected, subaccount } = connectionStore;
  const { linesSizeByAmount, linesShowAmount } = prefs;
  const { baseAsset, quoteAsset } = usePathToMetadata();
  const getMetadata = useGetMetadata();

  const { data: positions } = usePositions(subaccount, [PositionState_PositionStateEnum.OPENED]);

  useEffect(() => {
    // Wrap the line rebuild in a mobx `autorun` so it re-fires whenever
    // `ownPositionDragOverrides` changes (drag start / move / drop).
    // React-query's `positions` isn't observable, so it lives in the
    // outer effect deps — a fresh page of positions destroys the old
    // autorun and creates a new one with the new closure.
    const dispose = autorun(() => {
      if (!connected || !baseAsset || !quoteAsset || !positions?.size) {
        setLines([]);
        return;
      }
      const display = getDisplayPositions({
        positions,
        getMetadata,
        asset1Filter: baseAsset,
        asset2Filter: quoteAsset,
      });

      // First pass: build every line with its raw price/direction/amount.
      // Amount is only meaningful on the side the rung actually offers —
      // base reserves for an ask (sell), quote reserves for a bid (buy) —
      // matching the convention lp-preview-overlay already uses for the
      // draft LP form.
      interface RawLine {
        id: string;
        price: number;
        direction: 'buy' | 'sell' | '';
        baseAmount?: number;
        quoteAmount?: number;
      }
      const raw: RawLine[] = [];
      for (const dp of display) {
        if (!dp.isOpened) {
          continue;
        }
        for (const [i, o] of dp.orders.entries()) {
          const key = `${dp.idString}-${i}`;
          // If the user is dragging this rung right now, paint the OG
          // line at the pointer-mapped price. Cleared on drop by the
          // drag overlay.
          const override = ownPositionDragOverrides.get(key);
          const price = override ?? pnum(o.effectivePrice).toNumber();
          if (!Number.isFinite(price) || price <= 0) {
            continue;
          }
          const directionRaw = o.direction.toLowerCase();
          const direction = directionRaw === 'buy' || directionRaw === 'sell' ? directionRaw : '';

          // CalculatedAsset.amount is already a display-unit BigNumber
          // (see get-calculated-assets.ts) — no exponent shifting needed.
          // Wrapped defensively: a malformed position shouldn't crash the
          // whole line rebuild, just fall back to a plain label/width 1
          // for that one line.
          let baseAmount: number | undefined;
          let quoteAmount: number | undefined;
          try {
            if (direction === 'sell') {
              const v = o.baseAsset.amount.toNumber();
              if (Number.isFinite(v) && v > 0) {
                baseAmount = v;
              }
            } else if (direction === 'buy') {
              const v = o.quoteAsset.amount.toNumber();
              if (Number.isFinite(v) && v > 0) {
                quoteAmount = v;
              }
            }
          } catch {
            // leave amounts undefined — falls back to plain label/width 1
          }

          raw.push({ id: key, price, direction, baseAmount, quoteAmount });
        }
      }

      // Max relevant amount across all lines on this pair, used to scale
      // line width by relative size (not absolute — a whale pair and a
      // dust pair both get the full 1/2/4 spread).
      const maxAmount = raw.reduce((m, l) => {
        const size = l.baseAmount ?? l.quoteAmount;
        return size !== undefined && size > m ? size : m;
      }, 0);

      const lines: OwnPositionLine[] = raw.map(l => {
        const size = l.baseAmount ?? l.quoteAmount;

        let lineWidth: number | undefined;
        if (linesSizeByAmount && size !== undefined && maxAmount > 0) {
          const ratio = size / maxAmount;
          lineWidth = 1;
          if (ratio >= BIG_RATIO) {
            lineWidth = 4;
          } else if (ratio >= MEDIUM_RATIO) {
            lineWidth = 2;
          }
        }

        let label = l.direction ? l.direction.toUpperCase() : 'LP';
        if (linesShowAmount && size !== undefined) {
          const symbol = l.baseAmount !== undefined ? baseAsset.symbol : quoteAsset.symbol;
          label = `${label} ${formatShortAmount(size)} ${symbol}`;
        }

        return {
          id: l.id,
          price: l.price,
          direction: l.direction,
          label,
          baseAmount: l.baseAmount,
          quoteAmount: l.quoteAmount,
          lineWidth,
        };
      });
      setLines(lines);
    });
    return dispose;
  }, [
    connected,
    positions,
    baseAsset,
    quoteAsset,
    getMetadata,
    setLines,
    // Both booleans, so listing them here is enough to re-fire the whole
    // effect (destroying and recreating the autorun with a closure over
    // the new pref values) whenever the user toggles either setting.
    linesSizeByAmount,
    linesShowAmount,
  ]);
};

// Mark as observer-friendly so connectionStore changes propagate.
export const observeOwnPositionLines = observer;

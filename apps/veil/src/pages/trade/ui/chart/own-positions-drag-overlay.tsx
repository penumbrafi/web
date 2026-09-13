'use client';

import { useEffect, useMemo, useRef, useState, FC } from 'react';
import { observer } from 'mobx-react-lite';
import { pnum } from '@penumbra-zone/types/pnum';
import {
  Position,
  PositionId,
  PositionState_PositionStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { connectionStore } from '@/shared/model/connection';
import { usePositions } from '@/entities/position/api/use-positions';
import { editPosition } from '@/entities/position/api/edit-position';
import { getDisplayPositions } from '@/entities/position/model/get-display-positions';
import { useGetMetadata } from '@/shared/api/assets';
import { usePathToMetadata } from '../../model/use-path';
import { planToPosition, LiquidityDistributionShape } from '@/shared/math/position';

const BUY_COLOR = '#55d383';
const SELL_COLOR = '#f17878';
const HANDLE_SIZE = 10;

interface Rung {
  key: string;
  y: number;
  price: number;
  direction: 'buy' | 'sell' | '';
  positionId: PositionId;
  position: Position;
  baseExponent: number;
  quoteExponent: number;
}

interface Props {
  yAtPrice: (price: number) => number | undefined;
  priceAtY: (y: number) => number | undefined;
  subscribeRedraw: (cb: () => void) => () => void;
  enabled: boolean;
}

/**
 * Drag any of your own resting LP-position price lines vertically on
 * the chart to reprice. On drop we close the old position and open a
 * fresh one at the new price in the same tx (editPosition), preserving
 * reserves + fee tier + liquidity shape from the existing plan.
 *
 * Renders only handles — the horizontal lines themselves are drawn by
 * useOwnPositionLines via lightweight-charts' native PriceLine API and
 * live behind this overlay. This component is invisible aside from the
 * grabber squares at each line's y.
 */
export const OwnPositionsDragOverlay: FC<Props> = observer(
  ({ yAtPrice, priceAtY, subscribeRedraw, enabled }) => {
    const { connected, subaccount } = connectionStore;
    const { baseAsset, quoteAsset } = usePathToMetadata();
    const getMetadata = useGetMetadata();

    const { data: pages } = usePositions(subaccount, [
      PositionState_PositionStateEnum.OPENED,
    ]);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [, force] = useState(0);
    const dragRef = useRef<{ key: string; pointerId: number; y: number } | null>(null);
    const [dragY, setDragY] = useState<{ key: string; y: number } | null>(null);

    // Precompute the list of draggable rungs from the wallet's open
    // positions on the current pair. Each rung carries enough context
    // to rebuild a Position at a new price on drop.
    const rungs: Rung[] = useMemo(() => {
      if (!connected || !enabled || !baseAsset || !quoteAsset || !pages?.pages.length) {
        return [];
      }
      const display = getDisplayPositions({
        positions: pages.pages,
        getMetadata,
        asset1Filter: baseAsset,
        asset2Filter: quoteAsset,
      });
      const out: Rung[] = [];
      for (const dp of display) {
        if (!dp.isOpened) continue;
        for (let i = 0; i < dp.orders.length; i++) {
          const o = dp.orders[i]!;
          const price = pnum(o.effectivePrice).toNumber();
          if (!Number.isFinite(price) || price <= 0) continue;
          const dir = o.direction.toLowerCase();
          out.push({
            key: `${dp.idString}-${i}`,
            y: 0,
            price,
            direction: dir === 'buy' ? 'buy' : dir === 'sell' ? 'sell' : '',
            positionId: dp.id,
            position: dp.position,
            baseExponent: o.baseAsset.exponent,
            quoteExponent: o.quoteAsset.exponent,
          });
        }
      }
      return out;
    }, [connected, enabled, baseAsset, quoteAsset, pages, getMetadata]);

    // Recompute y-coordinates on any chart repaint (pan/zoom/resize).
    // useRef so subscribeRedraw's callback can read the latest rungs.
    const yByKeyRef = useRef<Map<string, number>>(new Map());
    useEffect(() => {
      const update = () => {
        const m = new Map<string, number>();
        for (const r of rungs) {
          const y = yAtPrice(r.price);
          if (y !== undefined) m.set(r.key, y);
        }
        yByKeyRef.current = m;
        force(x => x + 1);
      };
      const unsub = subscribeRedraw(update);
      return unsub;
    }, [rungs, yAtPrice, subscribeRedraw]);

    if (!enabled || rungs.length === 0) return null;

    const onPointerDown =
      (rung: Rung) => (ev: React.PointerEvent<HTMLDivElement>) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        try {
          ev.currentTarget.setPointerCapture(ev.pointerId);
        } catch {
          // best-effort
        }
        dragRef.current = { key: rung.key, pointerId: ev.pointerId, y };
        setDragY({ key: rung.key, y });
        ev.preventDefault();
        ev.stopPropagation();
      };

    const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
      const state = dragRef.current;
      if (!state || state.pointerId !== ev.pointerId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      state.y = y;
      setDragY({ key: state.key, y });
    };

    const onPointerUp =
      (rung: Rung) => async (ev: React.PointerEvent<HTMLDivElement>) => {
        const state = dragRef.current;
        try {
          ev.currentTarget.releasePointerCapture(ev.pointerId);
        } catch {
          // best-effort
        }
        if (!state || state.pointerId !== ev.pointerId) return;
        const newPrice = priceAtY(state.y);
        dragRef.current = null;
        setDragY(null);
        if (
          newPrice === undefined ||
          !Number.isFinite(newPrice) ||
          newPrice <= 0 ||
          !baseAsset ||
          !quoteAsset
        ) {
          return;
        }
        // Skip if the drop is essentially at the same price (sub-bp
        // resolution) so an accidental click doesn't rewrite the LP.
        if (Math.abs(newPrice - rung.price) / rung.price < 0.001) {
          return;
        }
        // Rebuild the Position at the new price, preserving the
        // existing reserves + fee. shape is unknown here (the wallet
        // doesn't roundtrip strategy metadata) so we tag it as
        // CUSTOM/ARBITRARY, which is safe on the chain side.
        const existingFee = rung.position.phi?.component?.fee ?? 0;
        const r1 = pnum(rung.position.reserves?.r1, rung.baseExponent).toNumber();
        const r2 = pnum(rung.position.reserves?.r2, rung.quoteExponent).toNumber();
        const baseExp =
          baseAsset.denomUnits.find(u => u.denom === baseAsset.display)?.exponent ?? 0;
        const quoteExp =
          quoteAsset.denomUnits.find(u => u.denom === quoteAsset.display)?.exponent ?? 0;
        if (!baseAsset.penumbraAssetId || !quoteAsset.penumbraAssetId) return;
        const built = planToPosition(
          {
            baseAsset: { id: baseAsset.penumbraAssetId, exponent: baseExp },
            quoteAsset: { id: quoteAsset.penumbraAssetId, exponent: quoteExp },
            feeBps: existingFee,
            price: newPrice,
            baseReserves: r1,
            quoteReserves: r2,
          },
          LiquidityDistributionShape.CUSTOM,
        );
        await editPosition({
          oldPositionId: rung.positionId,
          newPosition: built.position,
          shape: LiquidityDistributionShape.CUSTOM,
        });
      };

    return (
      <div
        ref={containerRef}
        aria-label='Reposition your LP orders'
        className='pointer-events-none absolute inset-0 z-[6]'
      >
        {rungs.map(r => {
          const yLive =
            dragY?.key === r.key ? dragY.y : (yByKeyRef.current.get(r.key) ?? -9999);
          const color =
            r.direction === 'buy' ? BUY_COLOR : r.direction === 'sell' ? SELL_COLOR : '#9aa0a6';
          return (
            <div
              key={r.key}
              className='pointer-events-auto absolute'
              style={{
                right: 56 + 6,
                top: yLive - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: color,
                borderRadius: HANDLE_SIZE / 2,
                cursor: 'row-resize',
                opacity: 0.9,
                touchAction: 'none',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
              }}
              onPointerDown={onPointerDown(r)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp(r)}
              onPointerCancel={onPointerUp(r)}
              title={`Drag to reprice ${r.direction || 'order'} @ ${r.price.toPrecision(6)}`}
            />
          );
        })}
      </div>
    );
  },
);

OwnPositionsDragOverlay.displayName = 'OwnPositionsDragOverlay';

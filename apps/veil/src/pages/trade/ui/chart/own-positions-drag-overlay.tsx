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
    // Pending-confirmation state: on drop, we don't fire the tx immediately.
    // Instead we render a small confirmation card next to the drop location
    // showing old→new price and the sequence of actions (close, withdraw,
    // open) so the user knows what they're signing.
    //
    // Declared alongside the other useState hooks so the hook order stays
    // stable when the early return below fires. Previously it lived below
    // the `if (!enabled || rungs.length === 0) return null;`, which turned
    // any transition through that branch into a React #310.
    const [pending, setPending] = useState<{
      rung: Rung;
      newPrice: number;
      y: number;
    } | null>(null);

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
      (rung: Rung) => (ev: React.PointerEvent<HTMLDivElement>) => {
        const state = dragRef.current;
        try {
          ev.currentTarget.releasePointerCapture(ev.pointerId);
        } catch {
          // best-effort
        }
        if (!state || state.pointerId !== ev.pointerId) return;
        const newPrice = priceAtY(state.y);
        const y = state.y;
        dragRef.current = null;
        setDragY(null);
        if (newPrice === undefined || !Number.isFinite(newPrice) || newPrice <= 0) {
          return;
        }
        // Skip if the drop is essentially at the same price (sub-bp) so an
        // accidental click doesn't open a confirmation.
        if (Math.abs(newPrice - rung.price) / rung.price < 0.001) {
          return;
        }
        setPending({ rung, newPrice, y });
      };

    const confirmReprice = async () => {
      if (!pending || !baseAsset || !quoteAsset) {
        setPending(null);
        return;
      }
      const { rung, newPrice } = pending;
      setPending(null);
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
        oldPosition: rung.position,
        newPosition: built.position,
        shape: LiquidityDistributionShape.CUSTOM,
      });
    };

    // Live-drag price under the pointer for the drop tooltip + horizontal
    // guide line. Computed here so both the label and the line share the
    // same value.
    const dragLivePrice =
      dragY && rungs.some(r => r.key === dragY.key) ? priceAtY(dragY.y) : undefined;

    return (
      <div
        ref={containerRef}
        aria-label='Reposition your LP orders'
        className='pointer-events-none absolute inset-0 z-[6]'
      >
        {/* Horizontal guide line + price label under the pointer during drag.
            Lets the trader see the exact price they're moving the order to
            before they release. */}
        {dragY && dragLivePrice !== undefined && (
          <>
            <div
              className='absolute left-0'
              style={{
                right: 56,
                top: dragY.y - 0.5,
                height: 1,
                borderTop: '1px dashed rgba(255,255,255,0.6)',
              }}
            />
            <div
              className='absolute rounded-sm bg-base-black/85 px-1.5 py-0.5 text-[11px] tabular-nums text-text-primary'
              style={{
                right: 60,
                top: dragY.y - 10,
                lineHeight: '14px',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.15)',
              }}
            >
              {dragLivePrice.toPrecision(6)}
            </div>
          </>
        )}
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
        {/* Confirmation card — appears at the drop position with old→new
            price and the tx action list so the user knows what will be
            signed. Cancel dismisses without touching the chain. */}
        {pending && (
          <div
            className='pointer-events-auto absolute rounded-md border border-other-tonal-stroke bg-base-black/95 p-3 text-xs shadow-lg'
            style={{
              right: 72,
              top: Math.max(4, pending.y - 40),
              minWidth: 220,
              lineHeight: '16px',
            }}
          >
            <div className='mb-1 text-text-secondary'>Reprice {pending.rung.direction || 'order'}</div>
            <div className='mb-2 tabular-nums text-text-primary'>
              {pending.rung.price.toPrecision(6)}{' '}
              <span className='text-text-secondary'>→</span>{' '}
              {pending.newPrice.toPrecision(6)}
            </div>
            <div className='mb-2 text-[11px] text-text-secondary'>
              One tx: close the existing position, withdraw its reserves,
              open a new one at the new price. Same reserves, same fee tier.
            </div>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => setPending(null)}
                className='rounded px-2 py-1 text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => {
                  void confirmReprice();
                }}
                className='rounded bg-primary-main px-2 py-1 text-base-black hover:bg-primary-light'
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);

OwnPositionsDragOverlay.displayName = 'OwnPositionsDragOverlay';

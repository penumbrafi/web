import { observable, action } from 'mobx';

/**
 * Live price overrides for own-position lines drawn by
 * `useOwnPositionLines`. When the user grabs a rung ball in
 * OwnPositionsDragOverlay and drags it, the drag component pushes the
 * live pointer-mapped price in here keyed by rung id
 * (`${dp.idString}-${i}` — same shape both files build).
 *
 * `useOwnPositionLines` observes the map and rebuilds lines with the
 * overridden price so the OG solid PriceLine moves with the ball instead
 * of staying at the pre-drag price. Cleared on pointerup/cancel.
 */
export const ownPositionDragOverrides = observable.map<string, number>();

export const setDragOverride = action((key: string, price: number) => {
  ownPositionDragOverrides.set(key, price);
});

export const clearDragOverride = action((key: string) => {
  ownPositionDragOverrides.delete(key);
});

import { makeAutoObservable } from 'mobx';

/**
 * Whether an LP range edge is being dragged on the chart. The chart keeps
 * its price axis still while this is true: re-fitting the axis to the
 * moving range made the same pointer position mean a higher price every
 * frame, so dragging an edge toward the top ran away from the mouse.
 */
class LpDragState {
  active = false;

  constructor() {
    makeAutoObservable(this);
  }

  setActive(active: boolean) {
    this.active = active;
  }
}

export const lpDragState = new LpDragState();

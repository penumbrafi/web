import { useCallback, useEffect, useRef, useState } from 'react';
import type { Drawing } from './types';

/**
 * Drawings state with localStorage persistence and undo/redo history.
 *
 * Storage key is `veil-chart-drawings:<base>/<quote>` — deliberately *not*
 * scoped by candle duration ('1m'/'1d'/etc): a drawing is a mark on the
 * pair's price/time plane, not on a particular timeframe's bar grid, so
 * flipping duration must show the same drawings in the same place.
 *
 * `time` fields are always the drawing's true absolute UNIX seconds — never
 * floored/rounded to a bar boundary of whichever duration happened to be
 * selected when it was placed. Bucketing time here would be the bug: bar
 * boundaries differ per duration (a 1m click's bar start essentially never
 * coincides with a 1d bar start), so a time value quantized to one
 * duration's grid would silently drift or fail to resolve to a pixel at
 * all under a different one. Placement (chart.tsx) always derives `time`
 * from timeAtX/the native click time, and rendering (drawings-overlay.tsx)
 * always goes back through xAtTime — both of which (use-chart-config.tsx)
 * fall back to the chart's continuous logical-index space whenever the
 * exact-bar-match native lightweight-charts API can't place a value, so an
 * absolute time from one duration still resolves to a sensible pixel under
 * any other.
 *
 * Drawings are stored in chart coordinates (price), so panning/zooming the
 * chart leaves them anchored to the data, not the viewport.
 *
 * Undo/redo uses past[] and future[] stacks of full Drawing[] snapshots.
 * Snapshot is cheap because Drawing is small (a handful of numbers and
 * strings) and per-pair counts are tiny. Capped at HISTORY_LIMIT to bound
 * memory if a power user spams 10k drawings.
 */
const HISTORY_LIMIT = 200;

export const useDrawings = (pairKey: string) => {
  const storageKey = `veil-chart-drawings:${pairKey}`;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const pastRef = useRef<Drawing[][]>([]);
  const futureRef = useRef<Drawing[][]>([]);
  // Tick to surface canUndo/canRedo through React state (refs don't trigger
  // rerenders).
  const [, setHistoryTick] = useState(0);
  // Currently-selected drawing — drives the inline X-delete button, the
  // Delete/Backspace hotkey, and Ctrl/Cmd+C copy. Lives here (rather than
  // as component-local state in the overlay) so the chart-level keyboard
  // shortcuts and the overlay's inline UI share one source of truth.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load on mount / pair change. Switching pairs resets history — undoing
  // back into a previous pair would be confusing.
  useEffect(() => {
    pastRef.current = [];
    futureRef.current = [];
    setHistoryTick(t => t + 1);
    if (typeof window === 'undefined') {return;}
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Drawing[];
        if (Array.isArray(parsed)) {
          setDrawings(parsed);
          return;
        }
      }
    } catch {
      // ignore corrupt storage
    }
    setDrawings([]);
  }, [storageKey]);

  const persist = useCallback(
    (next: Drawing[]) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [storageKey],
  );

  // Mutate with history: push the current state to past, clear redo
  // stack. Plain functional updater — side-effects (history push +
  // localStorage write) happen inside the updater. In React 18
  // StrictMode dev, the updater runs twice and the past stack will
  // double-stack a step; that's a known dev-only annoyance, not a
  // correctness issue for prod.
  const mutate = useCallback(
    (compute: (curr: Drawing[]) => Drawing[]) => {
      setDrawings(curr => {
        const next = compute(curr);
        if (next === curr) {return curr;}
        pastRef.current = [...pastRef.current, curr].slice(-HISTORY_LIMIT);
        futureRef.current = [];
        persist(next);
        return next;
      });
      setHistoryTick(t => t + 1);
    },
    [persist],
  );

  const add = useCallback((d: Drawing) => mutate(curr => [...curr, d]), [mutate]);

  const remove = useCallback(
    (id: string) =>
      mutate(curr => {
        // Guard against a genuine no-op filter — `filter` always returns a
        // fresh array reference even when nothing matched, which would
        // otherwise push a phantom step onto the undo stack any time two
        // delete triggers fire for the same id (e.g. the inline X button
        // and the Delete-key handler both reacting to one keypress/click).
        if (!curr.some(d => d.id === id)) {return curr;}
        return curr.filter(d => d.id !== id);
      }),
    [mutate],
  );

  // Selection is separate from the undo/redo-tracked drawings array — it's
  // ephemeral UI state, not part of the persisted chart annotations.
  const select = useCallback((id: string | null) => setSelectedId(id), []);

  // Clear the selection if its target was just removed (via undo, remote
  // clear-all, etc.) so a stale id doesn't keep the X button / hotkeys
  // silently targeting a drawing that no longer exists.
  useEffect(() => {
    if (selectedId !== null && !drawings.some(d => d.id === selectedId)) {
      setSelectedId(null);
    }
  }, [drawings, selectedId]);

  // Patch a single drawing in place. Used for drag-to-move on
  // horizontal-line / trend-line / rectangle. Patch shape is a partial
  // of the same Drawing kind, so callers can update price / time fields
  // without recreating the whole shape.
  const update = useCallback(
    (id: string, patch: Partial<Drawing>) =>
      mutate(curr =>
        curr.map(d => (d.id === id ? ({ ...d, ...patch } as Drawing) : d)),
      ),
    [mutate],
  );

  const clearAll = useCallback(() => mutate(() => []), [mutate]);

  const undo = useCallback(() => {
    setDrawings(curr => {
      const prev = pastRef.current.pop();
      if (prev === undefined) {return curr;}
      futureRef.current = [curr, ...futureRef.current].slice(0, HISTORY_LIMIT);
      persist(prev);
      return prev;
    });
    setHistoryTick(t => t + 1);
  }, [persist]);

  const redo = useCallback(() => {
    setDrawings(curr => {
      const next = futureRef.current.shift();
      if (next === undefined) {return curr;}
      pastRef.current = [...pastRef.current, curr].slice(-HISTORY_LIMIT);
      persist(next);
      return next;
    });
    setHistoryTick(t => t + 1);
  }, [persist]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return {
    drawings,
    add,
    remove,
    update,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedId,
    select,
  };
};

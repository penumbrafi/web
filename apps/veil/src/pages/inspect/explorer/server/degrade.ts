/**
 * pindexer being unreachable is an operational state, not a bug: the explorer
 * reads it for charts and tables that are context, not the page.
 *
 * A rejection must not escape these readers. `pg` rejects with an
 * `AggregateError` (one entry per attempted address) whose empty message is
 * re-wrapped by React's aggregate-error handling into a fresh
 * `AggregateError(null)` — which throws "object null is not iterable" and
 * takes the whole RSC render down with it, empty shell and all. Catching at
 * the call site inside the module (rather than at the component) is what
 * keeps that from ever reaching the renderer.
 */
export const degrade =
  <T>(what: string, fallback: T) =>
  (err: unknown): T => {
    console.warn(`[explorer] ${what} unavailable`, err);
    return fallback;
  };

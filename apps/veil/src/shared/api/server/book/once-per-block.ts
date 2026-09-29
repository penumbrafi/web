// Server-side "at most one compute per key per block" cache, shared by the
// book routes (/api/book simulates, /api/book/v2 position scans). pd here is
// the validator's own node, so wasted book computes compete with consensus.
//
// A book can only change when a block commits, so the rule is: AT MOST ONE
// compute per key per block. Freshness is gated on chain height, not a
// timer: the cached value is served until pd reports a newer block, then the
// next request recomputes it (single-flighted, so every concurrent viewer
// shares that one compute). A timer can't do this: blocks are ~5.4s and
// jittery, so a 2s window recomputed each pair up to 3x per block, and a
// fixed 5s one would still double up on some blocks and lag on others.

export interface GateEntry<T> {
  data: T;
  /** Wall time the compute finished. */
  computedAt: number;
  /** Chain height the value was computed at, when known. */
  height?: bigint;
}

/**
 * What the gate did for one request. The caller maps it to headers:
 * `cached` (same block, or backing off) → HIT/STALE, `revalidate` → the
 * cached value while a background refresh runs, `inflight` / `miss` → a
 * cold compute this request waited on, `stale-fail` → that compute failed
 * but an older value exists, `empty` → nothing to serve at all.
 */
export type GateOutcome<T> =
  | { status: 'cached'; entry: GateEntry<T>; sameBlock: boolean; backingOff: boolean }
  | { status: 'revalidate'; entry: GateEntry<T> }
  | { status: 'inflight'; entry: GateEntry<T> }
  | { status: 'miss'; entry: GateEntry<T> }
  | { status: 'stale-fail'; entry: GateEntry<T> }
  | { status: 'empty'; reason: 'INFLIGHT-ABORT' | 'INFLIGHT-FAIL' | 'MISS-ABORT' | 'MISS-FAIL' };

// Bookkeeping TTL used for the entry's age math (HIT vs STALE header).
export const CACHE_TTL_MS = 4_000;
// Freshness window used ONLY when the chain height is unknown (getStatus
// failing). About one block.
const FALLBACK_FRESH_WINDOW_MS = 5_000;
// After a failed compute, don't try that key again for this long, and keep
// serving the last good value. Without it a slow pd got a new 10s simulate
// the moment the previous one timed out, per pair, forever: the pile-up that
// saturated pd on 2026-09-24.
const FAILURE_BACKOFF_MS = 15_000;

// One in-flight pd compute per cache key. `controller` lets us really
// cancel the upstream call (not just stop waiting for it): before,
// `withTimeout` rejected our promise while pd kept walking positions for
// a client that had already gone away, so under load pd accumulated
// zombie compute jobs. `waiters` counts requests awaiting this compute;
// when `cancelOnIdle` is set and the last one disconnects we abort so pd
// stops too. Background SWR refreshes have no waiters and never cancel
// on disconnect — they exist precisely to warm the cache for the next
// poll.
interface InflightCompute<T> {
  promise: Promise<GateEntry<T>>;
  controller: AbortController;
  waiters: number;
  cancelOnIdle: boolean;
}

// Await an in-flight compute on behalf of a request. If the request's own
// signal aborts (tab closed, fetch cancelled) we drop the waiter and, when
// nobody else is waiting, abort the upstream call.
const awaitAsWaiter = async <T>(
  entry: InflightCompute<T>,
  reqSignal: AbortSignal,
): Promise<GateEntry<T>> => {
  entry.waiters += 1;
  const onAbort = () => {
    entry.waiters -= 1;
    if (entry.waiters <= 0 && entry.cancelOnIdle && !entry.controller.signal.aborted) {
      entry.controller.abort(new Error('all requesters disconnected'));
    }
  };
  reqSignal.addEventListener('abort', onAbort, { once: true });
  try {
    return await entry.promise;
  } finally {
    reqSignal.removeEventListener('abort', onAbort);
    if (!reqSignal.aborted) {
      entry.waiters -= 1;
    }
  }
};

export const createOncePerBlockCache = <T>(logTag: string) => {
  const cache = new Map<string, GateEntry<T>>();
  /** Last compute ATTEMPT per key, successful or not. The one-per-block gate. */
  const lastAttempt = new Map<string, { height?: bigint; at: number; failed: boolean }>();
  const inflight = new Map<string, InflightCompute<T>>();

  const startCompute = (
    key: string,
    height: bigint | undefined,
    compute: (signal: AbortSignal) => Promise<T>,
    cancelOnIdle: boolean,
  ): InflightCompute<T> => {
    const controller = new AbortController();
    const promise = compute(controller.signal)
      .then(data => {
        const next: GateEntry<T> = { data, computedAt: Date.now(), height };
        cache.set(key, next);
        lastAttempt.set(key, { height, at: Date.now(), failed: false });
        return next;
      })
      .catch((err: unknown) => {
        // Record the failure unless every requester simply went away: a
        // cancelled compute says nothing about pd's health.
        if (!controller.signal.aborted) {
          lastAttempt.set(key, { height, at: Date.now(), failed: true });
        }
        throw err;
      })
      .finally(() => {
        if (inflight.get(key) === entry) {
          inflight.delete(key);
        }
      });
    const entry: InflightCompute<T> = { promise, controller, waiters: 0, cancelOnIdle };
    inflight.set(key, entry);
    return entry;
  };

  const get = async (
    key: string,
    height: bigint | undefined,
    compute: (signal: AbortSignal) => Promise<T>,
    reqSignal: AbortSignal,
  ): Promise<GateOutcome<T>> => {
    const now = Date.now();
    const cached = cache.get(key);

    // The one-per-block gate. Serve the cached value when it was computed at
    // the current height, or when this key was already attempted at this
    // height (even if that attempt failed), or while backing off from a
    // failure.
    if (cached) {
      const age = now - cached.computedAt;
      const attempt = lastAttempt.get(key);
      const sameBlock =
        height !== undefined
          ? cached.height === height || attempt?.height === height
          : age < FALLBACK_FRESH_WINDOW_MS;
      const backingOff = !!attempt?.failed && now - attempt.at < FAILURE_BACKOFF_MS;
      if (sameBlock || backingOff) {
        return { status: 'cached', entry: cached, sameBlock, backingOff };
      }
      // New block: serve this value now and refresh in the background,
      // rather than holding the request for the seconds a compute takes. It
      // is no less fresh in practice: a request that waited would get block
      // H's value only after that same delay, and the client polls again next
      // block anyway. Still one compute per key per block: the in-flight
      // entry gates it.
      const running = inflight.get(key);
      if (!running || running.controller.signal.aborted) {
        // Background compute: nobody waits on it, so it must not cancel when
        // this request ends, and its failure is handled (salvage + backoff).
        startCompute(key, height, compute, false).promise.catch(() => undefined);
      }
      return { status: 'revalidate', entry: cached };
    }

    // No cached entry at all (cold start, or a key nobody has viewed) — must
    // compute synchronously. Single-flight to avoid duplicate pd queries for
    // concurrent first-time requests. An in-flight entry whose controller
    // already fired is a dying promise (its rejection lands a microtask
    // later); don't attach to it, start fresh.
    const existing = inflight.get(key);
    if (existing && !existing.controller.signal.aborted) {
      try {
        return { status: 'inflight', entry: await awaitAsWaiter(existing, reqSignal) };
      } catch (err) {
        if (reqSignal.aborted) {
          // Client went away mid-wait; nobody will read this response.
          return { status: 'empty', reason: 'INFLIGHT-ABORT' };
        }
        // The in-flight compute rejected. Serve empty rather than 500 — the
        // caller will retry on the next block poll and the primary compute
        // path below will try again.
        console.error(`[${logTag}] inflight failed, serving empty fallback`, { key, err });
        return { status: 'empty', reason: 'INFLIGHT-FAIL' };
      }
    }

    // Let the compute finish even if this requester leaves: with one compute
    // per key per block its result serves every viewer, and pd's own
    // deadline still bounds it. Cancelling on disconnect meant a cold pair
    // whose first requester had a short budget (the trade page's 2.5s
    // prefetch) never got a cached value at all.
    const entry = startCompute(key, height, compute, false);
    try {
      return { status: 'miss', entry: await awaitAsWaiter(entry, reqSignal) };
    } catch (err) {
      if (reqSignal.aborted) {
        // Every requester disconnected. Not an outage — log quietly so ops
        // don't read tab-closes as pd failures.
        console.warn(`[${logTag}] compute cancelled, all requesters disconnected`, { key });
        return { status: 'empty', reason: 'MISS-ABORT' };
      }
      // pd unreachable, slow, or throwing. Prefer the last-known entry (a
      // concurrent compute may have landed one) to an empty value — a
      // slightly-stale book is a much better degradation than an empty
      // ladder while pd recovers.
      const salvage = cache.get(key);
      if (salvage) {
        console.error(`[${logTag}] compute failed, serving stale fallback`, {
          key,
          ageMs: Date.now() - salvage.computedAt,
          err,
        });
        return { status: 'stale-fail', entry: salvage };
      }
      console.error(`[${logTag}] compute failed, serving empty fallback`, { key, err });
      return { status: 'empty', reason: 'MISS-FAIL' };
    }
  };

  return {
    get,
    /** The last good value for `key`, without triggering anything. */
    peek: (key: string): GateEntry<T> | undefined => cache.get(key),
  };
};

/**
 * Backstop race for a pd call: if the transport ever ignored its abort
 * signal we still stop waiting shortly after the deadline instead of
 * hanging a request slot.
 */
export const withHardStop = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`pd call hard-stopped after ${ms}ms`)), ms);
  });
  return Promise.race([p, stop]).finally(() => {
    if (handle) {
      clearTimeout(handle);
    }
  });
};

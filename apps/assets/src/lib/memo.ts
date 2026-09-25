interface Entry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

/**
 * Process-wide TTL memo for query functions. Concurrent callers share one
 * in-flight promise; a rejected promise is evicted immediately so the next
 * request retries instead of pinning "indexer unreachable" for the TTL.
 */
export const memoTtl = <A extends string, T>(
  fn: (key: A) => Promise<T>,
  ttlMs: number,
): ((key: A) => Promise<T>) => {
  const cache = new Map<string, Entry<T>>();
  return (key: A) => {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.promise;
    }
    const promise = fn(key);
    cache.set(key, { promise, expiresAt: now + ttlMs });
    promise.catch(() => {
      if (cache.get(key)?.promise === promise) {
        cache.delete(key);
      }
    });
    return promise;
  };
};

export const CACHE_TTL_MS = 5 * 60 * 1000;

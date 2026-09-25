'use client';

import { useEffect, useState } from 'react';
import { isErrorResponse, type ErrorResponse } from '@/lib/api';

export type Loadable<T> =
  | { state: 'loading'; data?: T }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: ErrorResponse; data?: T };

/**
 * Fetch a JSON route handler. On refetch (url change) the previous data is
 * kept alongside `state: 'loading'`, so a chart holds its last render at
 * reduced opacity instead of flashing to a skeleton.
 */
export const useJson = <T>(url: string | null): Loadable<T> => {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' });

  useEffect(() => {
    if (url === null) {
      return;
    }
    const controller = new AbortController();
    setValue(prev => ({ state: 'loading', ...(prev.data !== undefined && { data: prev.data }) }));
    void (async () => {
      let next: Loadable<T>;
      try {
        const res = await fetch(url, { signal: controller.signal });
        const body: unknown = await res.json();
        if (isErrorResponse(body)) {
          next = { state: 'error', error: body };
        } else if (!res.ok) {
          next = {
            state: 'error',
            error: { error: 'indexer_unreachable', message: `HTTP ${res.status}` },
          };
        } else {
          next = { state: 'ready', data: body as T };
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        next = {
          state: 'error',
          error: {
            error: 'indexer_unreachable',
            message: err instanceof Error ? err.message : 'fetch failed',
          },
        };
      }
      if (!controller.signal.aborted) {
        setValue(prev => ({
          ...next,
          ...(next.state !== 'ready' && prev.data !== undefined && { data: prev.data }),
        }));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [url]);

  return value;
};

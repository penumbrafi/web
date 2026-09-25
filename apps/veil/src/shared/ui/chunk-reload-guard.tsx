'use client';

import { useEffect } from 'react';

/**
 * Window-level handler that reloads the page when an old client tab tries
 * to fetch a chunk hash that no longer exists on the server (typical after
 * a redeploy: webpack bakes the chunk hash into the running JS, then the
 * deploy invalidates the hash; any subsequent dynamic import 404s and
 * webpack throws a ChunkLoadError that the React boundary may not catch
 * because it fires during the import, before render).
 *
 * Mounts once at the root layout. Idempotent — listener attaches once and
 * the reload itself is gated to once per minute via sessionStorage so a
 * deploy that genuinely shipped a broken bundle won't put the user in a
 * reload loop.
 */
const HARD_RELOAD_KEY = '__veil_chunk_reload_at';
const RELOAD_GRACE_MS = 60_000;

const isChunkLoadError = (msg: string): boolean =>
  /Loading chunk \d+ failed|Loading CSS chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    msg,
  );

const reloadOnce = () => {
  try {
    const last = Number(window.sessionStorage.getItem(HARD_RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GRACE_MS) {return;}
    window.sessionStorage.setItem(HARD_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage may be disabled — fall through to reload anyway
  }
  window.location.reload();
};

export const ChunkReloadGuard = () => {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = (e.error as { name?: string; message?: string } | null)?.message ?? e.message ?? '';
      const name = (e.error as { name?: string } | null)?.name ?? '';
      if (name === 'ChunkLoadError' || isChunkLoadError(msg)) {
        e.preventDefault();
        reloadOnce();
      }
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { name?: string; message?: string } | string | undefined;
      if (typeof reason === 'string') {
        if (isChunkLoadError(reason)) {
          e.preventDefault();
          reloadOnce();
        }
        return;
      }
      const msg = reason?.message ?? '';
      const name = reason?.name ?? '';
      if (name === 'ChunkLoadError' || isChunkLoadError(msg)) {
        e.preventDefault();
        reloadOnce();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
};

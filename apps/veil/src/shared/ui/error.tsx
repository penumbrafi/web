'use client';

import { useEffect } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';

/**
 * Detects whether an error is the result of a stale-tab → next-deploy
 * mismatch (chunk hash now 404s). Browsers throw a ChunkLoadError or, for
 * dynamic imports, a generic Loading chunk N failed.
 */
const isChunkLoadError = (e: unknown): boolean => {
  if (!e) {return false;}
  const err = e as { name?: string; message?: string };
  if (err.name === 'ChunkLoadError') {return true;}
  return /Loading chunk \d+ failed|Loading CSS chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(
    err.message ?? '',
  );
};

const HARD_RELOAD_KEY = '__veil_chunk_reload_at';

/**
 * Force a hard reload, but only once per minute — guards against an infinite
 * loop if the new build also misses a chunk for some unrelated reason.
 */
const reloadOnce = () => {
  if (typeof window === 'undefined') {return;}
  try {
    const last = Number(window.sessionStorage.getItem(HARD_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) {return;}
    window.sessionStorage.setItem(HARD_RELOAD_KEY, String(Date.now()));
  } catch {
    // storage may be disabled — fall through to reload anyway
  }
  window.location.reload();
};

export function Error({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    if (isChunkLoadError(error)) {reloadOnce();}
  }, [error]);

  if (isChunkLoadError(error)) {
    return (
      <div className='flex flex-col items-center gap-3 p-8'>
        <Text color='text.secondary'>
          App was updated — refreshing to pick up the latest version…
        </Text>
      </div>
    );
  }

  return (
    <div className='flex flex-col items-start gap-4 p-8'>
      <Text large color='destructive.light'>
        {error.message}
      </Text>
      {reset && (
        <Button onClick={reset} priority='secondary'>
          Try again
        </Button>
      )}
    </div>
  );
}

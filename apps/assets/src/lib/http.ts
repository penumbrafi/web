import { IndexerUnavailableError } from '@/db/client';
import type { ErrorResponse } from './api';

const CACHE_HEADERS = {
  // Matches the in-process memo TTL: a proxy or browser may hold a response
  // as long as the server would have served the same one anyway. No
  // `public`: these sit behind basic auth, and while the data is the same
  // for every viewer there is no reason to invite shared caches to keep
  // authenticated responses.
  'Cache-Control': 'max-age=60, s-maxage=300, stale-while-revalidate=60',
};

const NO_STORE = { 'Cache-Control': 'no-store' };

export const jsonError = (error: ErrorResponse['error'], message: string, status: number) =>
  Response.json({ error, message } satisfies ErrorResponse, { status, headers: NO_STORE });

/**
 * Run a query for a route handler. Any failure to reach Postgres (missing
 * endpoint, connect timeout, statement timeout, network) becomes a 503 with
 * `error: 'indexer_unreachable'` that the dashboard renders as such. The
 * detailed cause goes to the server log, not the client.
 */
export const respond = async <T>(fn: () => Promise<T | null>): Promise<Response> => {
  try {
    const data = await fn();
    if (data === null) {
      return jsonError('not_found', 'no rows for this asset', 404);
    }
    return Response.json(data, { headers: CACHE_HEADERS });
  } catch (err) {
    const configured = !(err instanceof IndexerUnavailableError);
    console.error('indexer query failed', err);
    return jsonError(
      'indexer_unreachable',
      configured
        ? 'the pindexer database did not answer'
        : 'the indexer endpoint is not configured',
      503,
    );
  }
};

import { NextResponse } from 'next/server';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';

/**
 * Which Penumbra-side IBC channels are no longer usable.
 *
 * Asked for by the trade/explore UI to mark assets whose bridge is dead. It is
 * served from our own origin on purpose: the explorer GraphQL host sends
 * `Access-Control-Allow-Origin` only for the origins it knows about (prod and
 * dex.rotko.net yes, staging.penumbra.fi no), so a browser-side query would
 * silently fail on staging — the exact place deploys get checked.
 */
export interface IbcBridgeResponse {
  /** Channel ids in `channel-N` form, as they appear in base denoms. */
  pausedChannels: string[];
}

const EMPTY: IbcBridgeResponse = { pausedChannels: [] };

interface ClientStatusRow {
  clientId: string;
  status: string;
  channelId: string | null;
}

// Minimal projection of `IbcStats`: the channel, and whether its client can
// still relay. Same endpoint/shape the inspect page's ibcStatsQuery reads.
const IBC_STATS_QUERY = 'query IbcBridge { ibcStats { clientId status channelId } }';

interface IbcStatsResponse {
  data?: { ibcStats?: ClientStatusRow[] };
  errors?: unknown;
}

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY,
  logTag: 'ibc-bridge',
});

async function handleGet(): Promise<NextResponse<IbcBridgeResponse>> {
  const host = process.env['NEXT_PUBLIC_GRAPHQL_HOST'];
  if (!host) {
    throw new Error('NEXT_PUBLIC_GRAPHQL_HOST is not set');
  }

  const response = await withTimeout(
    fetch(`https://${host}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: IBC_STATS_QUERY }),
      // A client expires on a minutes scale, not a block scale: cache the
      // upstream answer for a minute so page navigation doesn't re-ask, while
      // still noticing a fresh expiry on the next minute boundary. (The client
      // hook adds its own, longer, staleTime on top.)
      next: { revalidate: 60 },
    }),
    DEFAULT_TIMEOUT_MS,
    'ibc-bridge ibcStats',
  );

  if (!response.ok) {
    throw new Error(`ibcStats query failed with ${response.status}`);
  }

  const body = (await response.json()) as IbcStatsResponse;
  const rows = body.data?.ibcStats;
  if (!rows) {
    throw new Error(`ibcStats query returned no data: ${JSON.stringify(body.errors ?? body)}`);
  }

  // `active` is the only usable state. `expired` means the client stopped
  // updating (relaying over its channels is refused, so transfers stop
  // settling) and `frozen` means it was frozen outright — both leave the
  // channel dead until a new one is opened, so both are "paused" to the UI.
  const paused = rows
    .filter(
      (row): row is ClientStatusRow & { channelId: string } =>
        row.status !== 'active' && !!row.channelId,
    )
    .map(row => row.channelId);

  return NextResponse.json({ pausedChannels: [...new Set(paused)].sort() });
}
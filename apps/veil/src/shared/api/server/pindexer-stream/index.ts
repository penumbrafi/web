import { NextRequest } from 'next/server';
import { Client } from 'pg';

// Long-lived shared LISTEN connection. Every /api/pindexer-stream request
// registers as a fan-out subscriber; the single pg Client relays every
// `pindexer_tick` NOTIFY to all of them. That way N connected browsers
// still open only ONE upstream LISTEN — otherwise every viewer would
// hold its own pg connection and pindexer's dst DB would run out of
// slots on modest traffic.

// `send` relays a tick frame; `close` tears the SSE response down (used
// when the upstream LISTEN dies so the browser reconnects instead of
// sitting on a heartbeat-only stream that will never carry data again).
interface Subscriber {
  send: (payload: string) => void;
  close: () => void;
}

const PG_PING_INTERVAL_MS = 30_000;
const PG_PING_TIMEOUT_MS = 10_000;

let listenClient: Client | null = null;
// In-flight connect promise. Without this, concurrent first requests each
// build their own `new Client()` + LISTEN — the first to finish becomes
// `listenClient`, the others are orphaned but their `on('notification')`
// handlers keep firing, so every NOTIFY reaches subscribers N times
// (duplicate ticks per pindexer commit). Cache the promise so parallel
// callers share one connect.
let connectPromise: Promise<Client> | null = null;
const subs = new Set<Subscriber>();

async function ensureListener(): Promise<void> {
  if (listenClient) {return;}
  if (connectPromise) {
    await connectPromise;
    return;
  }
  const connectionString = process.env['PENUMBRA_INDEXER_ENDPOINT'];
  if (!connectionString) {
    throw new Error('PENUMBRA_INDEXER_ENDPOINT not set');
  }
  connectPromise = (async () => {
    // `query_timeout` bounds the liveness ping below: a half-open TCP
    // socket doesn't reject `SELECT 1`, it hangs, so without a deadline
    // the ping could never detect anything. `keepAlive` asks the kernel
    // to probe the socket as well.
    const client = new Client({ connectionString, query_timeout: PG_PING_TIMEOUT_MS, keepAlive: true });
    await client.connect();

    client.on('notification', msg => {
      if (msg.channel !== 'pindexer_tick') {return;}
      const payload = msg.payload ?? '';
      for (const sub of subs) {
        try {
          sub.send(payload);
        } catch {
          // A single misbehaving subscriber must not take down the fan-out.
        }
      }
    });

    // Node's pg Client won't auto-reconnect; if the socket dies we drop
    // the singleton so the next request rebuilds it, AND close every
    // subscriber's SSE response. Without the latter the browsers keep an
    // EventSource that looks healthy (heartbeats still flow) but can never
    // receive a tick again — every tab silently goes stale.
    //
    // Everything is gated on `listenClient === client`: a stale client's
    // late 'error'/'end' must not wipe a NEWER healthy singleton, nor kill
    // subscribers that are now served by it. `subs` is module-global.
    let tornDown = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    const teardown = (reason: string, err?: unknown) => {
      if (tornDown) {
        return;
      }
      tornDown = true;
      if (ping) {
        clearInterval(ping);
      }
      void client.end().catch(() => {});
      if (listenClient !== client) {
        return;
      }
      console.error(`[pindexer-stream] listener ${reason}, resetting`, err);
      listenClient = null;
      connectPromise = null;
      // Copy: each `close` deletes itself from `subs`.
      for (const sub of Array.from(subs)) {
        try {
          sub.close();
        } catch {
          // already closed
        }
      }
    };
    client.on('error', err => teardown('error', err));
    client.on('end', () => teardown('ended'));

    await client.query('LISTEN pindexer_tick');
    listenClient = client;

    // Liveness ping. A LISTEN connection is otherwise idle for minutes
    // between ticks, and an idle-timeout on a NAT / pgbouncer / the server
    // side can drop it without the socket emitting 'error' or 'end' — the
    // singleton then looks healthy forever while no NOTIFY ever arrives
    // and every browser sits on a heartbeat-only stream. `SELECT 1` every
    // PG_PING_INTERVAL_MS (bounded by `query_timeout`) surfaces that; on
    // failure we run the same teardown as the error handler so
    // subscribers are closed and the next request rebuilds the listener.
    ping = setInterval(() => {
      if (tornDown) {
        return;
      }
      client.query('SELECT 1').catch((err: unknown) => teardown('ping failed', err));
    }, PG_PING_INTERVAL_MS);
    return client;
  })();
  try {
    await connectPromise;
  } catch (err) {
    // Reset so the next request retries instead of pinning a rejected
    // promise. The GET handler will fall through to emptyStream().
    connectPromise = null;
    throw err;
  }
}

// Empty, immediately-closed SSE stream. Served when the upstream LISTEN
// connection can't be established (indexer DB unreachable, env var
// missing) so the route degrades to "no live ticks" instead of throwing
// out of the handler -- which would otherwise 500 -> 502 every client
// that tries to subscribe, instead of just leaving them without
// realtime updates (they still get data via polling/refetch elsewhere).
function emptyStream(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Match the success path: defeat nginx's default response
      // buffering. Without this, nginx waits until it has buffered
      // some bytes before forwarding the response headers upstream —
      // and this stream immediately closes with zero bytes, so nginx
      // sometimes returns 502 to the browser instead of a legit
      // empty SSE. EventSource then reports "failed loading" instead
      // of the normal onopen-then-close behaviour we want here.
      'X-Accel-Buffering': 'no',
      'X-Fallback': 'empty',
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await ensureListener();
  } catch (err) {
    console.error('[pindexer-stream] ensureListener failed, serving empty stream', err);
    return emptyStream();
  }

  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (line: string) => {
          if (closed) {return;}
          try {
            controller.enqueue(encoder.encode(line));
          } catch {
            closed = true;
          }
        };

        // A first line so proxies flush headers immediately and clients
        // see the connection is live.
        write(': hello\n\n');

        // Heartbeat comment every 15s. SSE spec ignores lines starting
        // with `:` — this keeps intermediary proxies (nginx, cloudflare)
        // from timing out an otherwise-idle connection.
        const heartbeat = setInterval(() => write(`: keepalive ${Date.now()}\n\n`), 15_000);

        const subscriber: Subscriber = {
          // SSE frame: one event named `tick` with the raw NOTIFY payload
          // as data. Client parses the JSON on receive.
          send: payload => write(`event: tick\ndata: ${payload}\n\n`),
          // Upstream LISTEN died. Tell the client explicitly, then close so
          // EventSource's onerror fires and the client reconnects promptly
          // (a fresh request rebuilds the pg singleton).
          close: () => {
            write('event: bye\ndata: {}\n\n');
            cleanup();
          },
        };

        function cleanup() {
          if (closed) {return;}
          closed = true;
          clearInterval(heartbeat);
          subs.delete(subscriber);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }

        subs.add(subscriber);
        req.signal.addEventListener('abort', cleanup);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        // X-Accel-Buffering:no defeats nginx's default response buffering
        // for this route only, so ticks reach the client the instant we
        // write them instead of when nginx's buffer fills.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[pindexer-stream] stream setup failed, serving empty stream', err);
    return emptyStream();
  }
}

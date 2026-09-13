import { NextRequest } from 'next/server';
import { Client } from 'pg';

// Long-lived shared LISTEN connection. Every /api/pindexer-stream request
// registers as a fan-out subscriber; the single pg Client relays every
// `pindexer_tick` NOTIFY to all of them. That way N connected browsers
// still open only ONE upstream LISTEN — otherwise every viewer would
// hold its own pg connection and pindexer's dst DB would run out of
// slots on modest traffic.

type Subscriber = (payload: string) => void;

let listenClient: Client | null = null;
let subs = new Set<Subscriber>();

async function ensureListener(): Promise<void> {
  if (listenClient) return;
  const connectionString = process.env['PENUMBRA_INDEXER_ENDPOINT'];
  if (!connectionString) {
    throw new Error('PENUMBRA_INDEXER_ENDPOINT not set');
  }
  const client = new Client({ connectionString });
  await client.connect();

  client.on('notification', msg => {
    if (msg.channel !== 'pindexer_tick') return;
    const payload = msg.payload ?? '';
    for (const fn of subs) {
      try {
        fn(payload);
      } catch {
        // A single misbehaving subscriber must not take down the fan-out.
      }
    }
  });

  client.on('error', err => {
    // Node's pg Client won't auto-reconnect; if the socket dies we drop
    // the singleton so the next request rebuilds it. Better than a
    // silently-dead listener that has no upstream.
    // eslint-disable-next-line no-console
    console.error('[pindexer-stream] listener error, resetting', err);
    void client.end().catch(() => {});
    listenClient = null;
  });

  await client.query('LISTEN pindexer_tick');
  listenClient = client;
}

export async function GET(req: NextRequest): Promise<Response> {
  await ensureListener();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };

      // A first line so proxies flush headers immediately and clients
      // see the connection is live.
      write(': hello\n\n');

      const subscriber: Subscriber = payload => {
        // SSE frame: one event named `tick` with the raw NOTIFY payload
        // as data. Client parses the JSON on receive.
        write(`event: tick\ndata: ${payload}\n\n`);
      };
      subs.add(subscriber);

      // Heartbeat comment every 15s. SSE spec ignores lines starting
      // with `:` — this keeps intermediary proxies (nginx, cloudflare)
      // from timing out an otherwise-idle connection.
      const heartbeat = setInterval(() => write(`: keepalive ${Date.now()}\n\n`), 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subs.delete(subscriber);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

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
}

'use client';

import {
  parseDexTraces,
  type CometbftAbciEvent,
  type CometbftDexTrace,
} from '@/shared/cometbft/dex-block-candles';

/**
 * Subscribe to NewBlock events directly from a CometBFT RPC WebSocket.
 *
 * The explorer used to drive live-block updates through the indexer's
 * GraphQL subscription (`wss://api.explorer.rotko.net/graphql/ws`). That
 * path is fragile: the WS proxy, the indexer process, and the pg
 * notification fan-out all sit between the chain and the browser, and
 * any of them failing leaves the panel frozen with no obvious signal.
 *
 * CometBFT's own RPC already exposes a public WebSocket
 * (`wss://penumbra.rotko.net/websocket`) that pushes the full block
 * header on every commit. Subscribing there is one round-trip from
 * source of truth to the user — no indexer in the path — so live
 * updates can't go stale even when the indexer's other surfaces are
 * having a bad day.
 */
export interface CometbftNewBlock {
  height: number;
  time: string;
  txCount: number;
}

/**
 * Public CometBFT RPC WebSocket. Every consumer that wants new-block events
 * subscribes here rather than through an indexer, so live updates survive an
 * indexer outage.
 */
export const COMETBFT_WS_URL =
  process.env['NEXT_PUBLIC_COMETBFT_WS_URL'] ?? 'wss://penumbra.rotko.net/websocket';

/**
 * Per-block dex payload: every position's swap trace in the block, as the
 * chain itself emitted them. Consumers that only care about the header skip
 * the parse by leaving `onDex` unset.
 */
export interface CometbftDexBlock {
  height: number;
  time: string;
  traces: CometbftDexTrace[];
}

interface SubscribeOptions {
  url: string;
  onBlock: (block: CometbftNewBlock) => void;
  /**
   * Called with the block's swap traces after `onBlock` (never with an empty
   * list, so consumers don't have to filter idle blocks themselves).
   */
  onDex?: (dex: CometbftDexBlock) => void;
  onError?: (err: unknown) => void;
}

// Exponential backoff capped at 15s. The chain produces a block every
// ~5s, so a 15s ceiling means at most a 3-block gap before reconnect.
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

const SUBSCRIBE_ID = 'penumbra-veil-newblock';

/** A CometBFT NewBlock event frame; the subscribe ack and keepalives lack most of it. */
interface NewBlockMessage {
  result?: {
    data?: {
      value?: {
        block?: {
          header?: { height?: string | number; time?: string };
          data?: { txs?: unknown };
        };
        result_end_block?: {
          events?: CometbftAbciEvent[];
        };
      };
    };
  };
}

export const subscribeToNewBlocks = ({
  url,
  onBlock,
  onDex,
  onError,
}: SubscribeOptions): (() => void) => {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped) {
      return;
    }
    try {
      ws = new WebSocket(url);
    } catch (err) {
      onError?.(err);
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      attempt = 0;
      ws?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'subscribe',
          id: SUBSCRIBE_ID,
          params: { query: "tm.event='NewBlock'" },
        }),
      );
    });

    ws.addEventListener('message', e => {
      try {
        const msg = JSON.parse(String(e.data)) as NewBlockMessage | null;
        // The first message after subscribe is an empty ack; skip it.
        // Subsequent messages carry the block under result.data.value.
        const header = msg?.result?.data?.value?.block?.header;
        if (!header) {
          return;
        }
        const txs = msg.result?.data?.value?.block?.data?.txs ?? [];
        const block = {
          height: Number(header.height),
          time: String(header.time),
          txCount: Array.isArray(txs) ? txs.length : 0,
        };
        onBlock(block);
        if (onDex) {
          const traces = parseDexTraces(msg.result?.data?.value?.result_end_block?.events);
          if (traces.length) {
            onDex({ height: block.height, time: block.time, traces });
          }
        }
      } catch (err) {
        onError?.(err);
      }
    });

    ws.addEventListener('error', err => {
      onError?.(err);
      // 'close' fires immediately after; reconnect handled there.
    });

    ws.addEventListener('close', () => {
      ws = null;
      scheduleReconnect();
    });
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    ws?.close();
  };
};

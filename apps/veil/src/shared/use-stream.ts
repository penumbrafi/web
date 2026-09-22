'use client';

import { useEffect } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';

type StreamId = string;

interface StreamConfig {
  id: StreamId;
  enabled?: boolean;
  streamFn: (signal: AbortSignal) => Promise<void> | void;
  /**
   * A value identifying the resource the stream is bound to (e.g. the gRPC
   * transport). When it changes, the SHARED stream is torn down and restarted
   * with the new `streamFn` — even if the reference count never reaches zero.
   *
   * Why this exists: many consumers share one `id`, each with its own
   * `streamFn` closure, so we cannot rebind by comparing `streamFn` identity
   * (every consumer's differs and it would thrash). But they all receive the
   * SAME transport object from one shared query, so `resubscribeKey` is
   * identical across them — exactly one rebind per transport change, no thrash.
   * Without this, a connection flip changed the transport but the refcount
   * stayed > 0, so the shared stream kept running against the DEAD transport and
   * block ticks silently stopped (price/book/balances froze until a reload).
   * Optional: callers that omit it keep the exact previous behaviour.
   */
  resubscribeKey?: unknown;
}

interface StreamState {
  controller: AbortController;
  activeStreamCount: number;
  resubscribeKey: unknown;
}

const streamStates = new Map<StreamId, StreamState>();

/**
 * A hook for managing shared gRPC streams across multiple components.
 *
 * When multiple components need to consume the same stream, this hook ensures only
 * one stream is created and shared between them. The stream is automatically cleaned up
 * when no components are using it.
 *
 * Remember that the function passed in needs to be memoized. Either defined globally or use useCallback.
 */
export const useStream = ({ id, enabled = true, streamFn, resubscribeKey }: StreamConfig) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let streamState = streamStates.get(id);
    if (!streamState) {
      streamState = {
        activeStreamCount: 0,
        controller: new AbortController(),
        resubscribeKey,
      };
      streamStates.set(id, streamState);
      void streamFn(streamState.controller.signal);
    } else if (streamState.resubscribeKey !== resubscribeKey) {
      // The bound resource changed (e.g. transport flipped): rebind the shared
      // stream even though other consumers keep the refcount > 0, so ticks don't
      // stop on a dead transport. Shared `resubscribeKey` means only the first
      // consumer this render does the swap; the rest see it already matching.
      streamState.controller.abort(STREAM_ABORT_MSG);
      streamState.controller = new AbortController();
      streamState.resubscribeKey = resubscribeKey;
      void streamFn(streamState.controller.signal);
    }

    // Increment active stream count
    streamState.activeStreamCount++;

    return () => {
      streamState.activeStreamCount--;

      // Only abort stream if no components are using it
      if (streamState.activeStreamCount === 0) {
        streamState.controller.abort(STREAM_ABORT_MSG);
        streamStates.delete(id);
      }
    };
  }, [enabled, streamFn, id, resubscribeKey]);
};

const STREAM_ABORT_MSG = 'useStream unmounting';

export const errorIsStreamAbort = (error: unknown) => {
  // Connect-Web wraps our AbortController.abort() as ConnectError(Canceled)
  // on some code paths, but on others the streaming iterator throws a
  // plain DOMException/Error whose message carries our abort reason.
  // Both are the same "consumer unmounted, nothing to do here" event —
  // don't log-and-reconnect either one.
  return (
    (error instanceof ConnectError && error.code === Code.Canceled) ||
    (error instanceof Error && error.message.includes(STREAM_ABORT_MSG))
  );
};

/**
 * Readiness and the thread pool.
 *
 * Importing any entry point of this package already loads the wasm module
 * (see instance.ts), so most code never needs this file. The one thing that is
 * explicit is the thread pool: proving runs on it when it exists and on the
 * calling thread when it does not.
 *
 *   // in the dedicated worker that proves:
 *   import { startThreads } from '@penumbrafi/wasm/init';
 *   await startThreads(navigator.hardwareConcurrency);
 */
import './instance.js';
import * as wasm from '../wasm/index.js';

let threads: Promise<void> | undefined;

/**
 * Resolves once the module is ready. Kept for callers that awaited it before
 * the module loaded itself; by the time this can be called, it is ready.
 */
export const initWasm = (): Promise<void> => Promise.resolve();

/** Whether this context has started a thread pool. */
export const threadsStarted = (): boolean => threads !== undefined;

const inDedicatedWorker = (): boolean => {
  const scope = (globalThis as { DedicatedWorkerGlobalScope?: new () => unknown })
    .DedicatedWorkerGlobalScope;
  return typeof scope === 'function' && globalThis instanceof scope;
};

/**
 * Start the thread pool for this context. Call it once, from a dedicated
 * worker, before proving.
 *
 * Only a dedicated worker may own the pool. While the pool runs, a caller
 * waits for rayon and for locks shared with the pool threads (even the
 * allocator's) with `memory.atomic.wait`, which traps on a page's main thread.
 * A page or service worker keeps a pool-less instance, where nothing can
 * contend and rayon runs on the calling thread.
 */
export const startThreads = (count: number): Promise<void> => {
  if (!inDedicatedWorker()) {
    throw new Error('startThreads must run in a dedicated worker, not a page or service worker');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`startThreads: invalid thread count ${count}`);
  }
  if (!('initThreadPool' in wasm)) {
    throw new Error('this @penumbrafi/wasm build has no thread support');
  }
  threads ??= (wasm.initThreadPool as (n: number) => Promise<unknown>)(count).then(() => undefined);
  return threads;
};

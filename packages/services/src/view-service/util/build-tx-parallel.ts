/**
 * Parallel transaction building using rayon thread pool via offscreen worker.
 *
 * This module provides an alternative to the standard offscreen-based parallel build
 * that uses wasm-bindgen-rayon for true multi-threaded WASM execution.
 *
 * Benefits:
 * - No JS worker overhead per action
 * - All actions build concurrently in WASM via rayon's par_iter()
 * - Better CPU utilization for multi-action transactions
 *
 * The rayon build happens in an offscreen worker because:
 * - Service workers have restrictions on spawning Web Workers
 * - Offscreen documents can spawn workers freely
 * - The offscreen worker initializes the rayon thread pool once and reuses it
 */

import {
  Action,
  AuthorizationData,
  Transaction,
  TransactionPlan,
  WitnessData,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import {
  AuthorizeAndBuildResponse,
  WitnessAndBuildResponse,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { PartialMessage } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { buildParallel } from '@penumbrafi/wasm/build';
import { FullViewingKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { offscreenClient } from '../../offscreen-client.js';

/**
 * Check if parallel build is available.
 *
 * In the extension context, SharedArrayBuffer is only available in the
 * offscreen document (with cross-origin isolation), not in the service worker.
 * We return true if we're in an extension context, since the offscreen worker
 * will handle the actual SharedArrayBuffer check.
 *
 * For web contexts, we check for SharedArrayBuffer directly.
 */
export const isParallelBuildAvailable = (): boolean => {
  // In Chrome extension context, always return true - the offscreen document
  // has cross-origin isolation and SharedArrayBuffer support
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `chrome` exists without `runtime` on ordinary web pages in Chromium
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return true;
  }

  // In web contexts, check for SharedArrayBuffer directly
  return typeof SharedArrayBuffer !== 'undefined';
};

type BuildResponse = PartialMessage<AuthorizeAndBuildResponse | WitnessAndBuildResponse>;

const TICK_MS = 50;
const tick = () =>
  new Promise<void>(r => {
    setTimeout(r, TICK_MS);
  });

const logDuration = (label: string, start: number) =>
  console.debug(`[Build] ${label}: ${(performance.now() - start).toFixed(0)}ms`);

/** Progress curve: from `from` towards `to`, ~halfway after `halfMs`. */
const ease = (elapsed: number, from: number, to: number, halfMs: number) =>
  from + (to - from) * (1 - 1 / (1 + elapsed / halfMs));

const progress = (value: number): BuildResponse => ({
  status: { case: 'buildProgress', value: { progress: value } },
});

/** The offscreen document or its wasm build can't prove without auth data. */
const isProveUnsupported = (e: unknown) => ConnectError.from(e).code === Code.Unimplemented;

interface Settled<T> {
  done: boolean;
  value?: T;
  error?: unknown;
}

/** Track a promise's outcome without ever leaving a rejection unhandled. */
const track = <T>(p: PromiseLike<T>): Settled<T> => {
  const s: Settled<T> = { done: false };
  Promise.resolve(p).then(
    value => {
      s.value = value;
      s.done = true;
    },
    (error: unknown) => {
      s.error = error;
      s.done = true;
    },
  );
  return s;
};

/**
 * Optimistic parallel build using rayon via offscreen worker.
 *
 * Proving starts immediately, concurrently with the approval prompt: proofs
 * need only the FVK and witness. The AuthorizationData (spend-auth signatures)
 * is applied afterwards, only once `authorizationRequest` resolves, so no
 * signed transaction can exist without explicit approval. If approval is
 * denied the proofs are discarded.
 *
 * @param transactionPlan - The transaction plan
 * @param witnessData - The witness data
 * @param authorizationRequest - Promise for authorization data
 * @param fvk - The full viewing key
 */
export const optimisticParallelBuild = async function* (
  transactionPlan: TransactionPlan,
  witnessData: WitnessData,
  authorizationRequest: PromiseLike<AuthorizationData>,
  fvk: FullViewingKey,
): AsyncGenerator<BuildResponse> {
  const start = performance.now();

  // Phase 1: prove now, while the user is looking at the approval prompt.
  // The offscreen client holds its refcount until the job actually settles,
  // even if we stop waiting for it (rejection), so it is never torn down mid-job.
  const proving = track<Action[]>(
    offscreenClient.proveParallelWithRayon(transactionPlan, witnessData, fvk),
  );
  const auth = track<AuthorizationData>(authorizationRequest);

  let proofsLogged = false;
  const logProofs = () => {
    if (proving.done && !proofsLogged) {
      proofsLogged = true;
      logDuration(proving.error ? 'proving failed after' : 'proofs ready', start);
    }
  };

  // Wait for approval, animating on proving progress.
  while (!auth.done) {
    logProofs();
    yield progress(
      proving.done && !proving.error ? 0.9 : ease(performance.now() - start, 0.05, 0.85, 3000),
    );
    await tick();
  }
  logDuration('approval received', start);

  if (auth.error !== undefined || !auth.value) {
    // Denied / cancelled: discard whatever the prover produces.
    throw ConnectError.from(
      auth.error ?? new Error('No authorization data'),
      Code.PermissionDenied,
    );
  }
  const authData = auth.value;

  // Proofs may still be running if the user approved quickly.
  while (!proving.done) {
    yield progress(ease(performance.now() - start, 0.05, 0.9, 3000));
    await tick();
  }
  logProofs();

  let transaction: Transaction;
  if (proving.error !== undefined || !proving.value) {
    if (!isProveUnsupported(proving.error)) {
      throw ConnectError.from(proving.error ?? new Error('Proving produced no actions'));
    }
    // Older offscreen document / wasm without prove-only support: fall back to
    // the combined build, which needs auth up front.
    console.warn('[Build] prove-before-approval unsupported, falling back to BUILD_PARALLEL');
    yield progress(0.2);
    const build = track(
      offscreenClient.buildParallelWithRayon(transactionPlan, witnessData, fvk, authData),
    );
    const buildStart = performance.now();
    while (!build.done) {
      yield progress(ease(performance.now() - buildStart, 0.2, 0.9, 3000));
      await tick();
    }
    if (build.error !== undefined || !build.value) {
      throw ConnectError.from(build.error ?? new Error('Build produced no transaction'));
    }
    transaction = build.value;
  } else {
    // Phase 2: apply authorization and assemble (cheap: no proving).
    yield progress(0.95);
    const assembleStart = performance.now();
    transaction = await buildParallel(proving.value, transactionPlan, witnessData, authData);
    logDuration('assembly (apply auth)', assembleStart);
  }

  logDuration('total build', start);

  yield {
    status: {
      case: 'complete',
      value: { transaction },
    },
  };
};

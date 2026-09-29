import { FullViewingKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import {
  Action,
  AuthorizationData,
  Transaction,
  TransactionPlan,
  WitnessData,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { Code, ConnectError } from '@connectrpc/connect';
import { errorFromJson } from '@connectrpc/connect/protocol-connect';
import {
  ActionBuildMessage,
  ParallelBuildMessage,
  ParallelProveMessage,
  OffscreenMessage,
} from '@penumbra-zone/types/internal-msg/offscreen';
import { InternalRequest, InternalResponse } from '@penumbra-zone/types/internal-msg/shared';
import type { Jsonified } from '@penumbra-zone/types/jsonified';

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

/**
 * How long the offscreen document (persistent build worker, rayon pool, cached
 * proving keys, instantiated wasm) is kept alive after its last use. Closing it
 * after every build throws away ~100MB of parsed proving keys and the whole
 * wasm/rayon init, which dominates the cost of the next build.
 */
export const OFFSCREEN_IDLE_MS = 4 * 60_000;

/** Slack so a timer that fires a little early still counts as idle. */
const IDLE_GRACE_MS = 5_000;

/**
 * Service worker -> offscreen document: "are you busy?". The document is the
 * authority on in-flight jobs, because some jobs (e.g. zcash proving) are sent
 * to it directly from other extension contexts and never pass through here.
 * Expected response: {@link OffscreenStatus}.
 */
export const OFFSCREEN_STATUS_MSG = 'OFFSCREEN_STATUS';

/**
 * Offscreen document -> service worker: "I have been idle for
 * OFFSCREEN_IDLE_MS". The document's own timer is reliable; a service-worker
 * setTimeout is not (MV3 service workers are torn down after ~30s idle), so the
 * host should route this message to {@link closeIfIdle}.
 */
export const OFFSCREEN_IDLE_MSG = 'OFFSCREEN_IDLE';

export interface OffscreenStatus {
  /** jobs currently executing in the document (any kind) */
  inFlight: number;
  /** ms since the document last started or finished a job */
  idleMs: number;
}

const isOffscreenStatus = (x: unknown): x is OffscreenStatus =>
  x != null &&
  typeof x === 'object' &&
  'inFlight' in x &&
  typeof x.inFlight === 'number' &&
  'idleMs' in x &&
  typeof x.idleMs === 'number';

const logDuration = (label: string, start: number) =>
  console.debug(`[offscreen-client] ${label}: ${(performance.now() - start).toFixed(0)}ms`);

/** in-flight jobs issued by this service worker */
let active = 0;
/** Date.now() of the last activate/release/touch */
let lastUse = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let creating: Promise<void> | undefined;
let closing: Promise<void> | undefined;

const hasOffscreenDocument = async () =>
  (
    await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    })
  ).length > 0;

const ensureOffscreenDocument = async () => {
  // never race a create against an in-progress close
  await closing;

  if (await hasOffscreenDocument()) {
    return;
  }

  // serialize concurrent creators; chrome allows only one offscreen document
  creating ??= (async () => {
    const start = performance.now();
    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Manages Penumbra transaction WASM workers',
      });
      logDuration('offscreen document created', start);
    } catch (e: unknown) {
      // the offscreen window might have been created by another context since we checked
      console.warn('Failed to create offscreen window', e);
    }
  })().finally(() => {
    creating = undefined;
  });

  await creating;
};

const scheduleIdleClose = (delayMs = OFFSCREEN_IDLE_MS) => {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (active) {
    // release() will reschedule once the last job settles
    return;
  }
  // Best effort only: this timer dies with the service worker. The offscreen
  // document runs its own idle timer and sends OFFSCREEN_IDLE_MSG.
  idleTimer = setTimeout(() => void closeIfIdle(), delayMs);
};

/**
 * Mark the offscreen document as recently used, pushing back idle close.
 * Also creates the document if it doesn't exist. Use for work that is sent to
 * the document by other contexts (e.g. zcash proving) so it stays warm too.
 */
const touch = async () => {
  lastUse = Date.now();
  await ensureOffscreenDocument();
  scheduleIdleClose();
};

const activateOffscreen = async () => {
  active++;
  lastUse = Date.now();
  clearTimeout(idleTimer);
  idleTimer = undefined;
  try {
    await ensureOffscreenDocument();
  } catch (e) {
    releaseOffscreen();
    throw e;
  }
};

/**
 * Decrement; once nothing is in flight, schedule close-after-idle. Must only be
 * called when the job has actually settled in the document, never merely
 * because the caller stopped caring (e.g. user rejected) - otherwise idle close
 * could kill a job that is still running.
 */
const releaseOffscreen = () => {
  active = Math.max(0, active - 1);
  lastUse = Date.now();
  scheduleIdleClose();
};

const queryDocumentStatus = async (): Promise<OffscreenStatus | undefined> => {
  try {
    const res: unknown = await Promise.race([
      chrome.runtime.sendMessage({ type: OFFSCREEN_STATUS_MSG }),
      new Promise<undefined>(resolve => {
        setTimeout(() => resolve(undefined), 1_000);
      }),
    ]);
    return isOffscreenStatus(res) ? res : undefined;
  } catch {
    // no receiver: no document, or one that predates the status protocol
    return undefined;
  }
};

/**
 * Close the offscreen document if nothing is using it and it has been idle for
 * OFFSCREEN_IDLE_MS, as seen by both this service worker and the document
 * itself. Safe to call at any time; returns true if the document was closed.
 */
const closeIfIdle = async (): Promise<boolean> => {
  if (active) {
    return false;
  }

  const swIdle = Date.now() - lastUse;
  if (swIdle < OFFSCREEN_IDLE_MS - IDLE_GRACE_MS) {
    scheduleIdleClose(OFFSCREEN_IDLE_MS - swIdle);
    return false;
  }

  const status = await queryDocumentStatus();
  if (status && (status.inFlight > 0 || status.idleMs < OFFSCREEN_IDLE_MS - IDLE_GRACE_MS)) {
    scheduleIdleClose(Math.max(IDLE_GRACE_MS, OFFSCREEN_IDLE_MS - status.idleMs));
    return false;
  }

  if (!(await hasOffscreenDocument())) {
    return false;
  }

  // re-check after the awaits: a job may have started meanwhile
  if (active || Date.now() - lastUse < OFFSCREEN_IDLE_MS - IDLE_GRACE_MS) {
    return false;
  }

  closing ??= chrome.offscreen
    .closeDocument()
    .then(() => console.debug('[offscreen-client] closed idle offscreen document'))
    .catch((e: unknown) => console.warn('Failed to close offscreen window', e))
    .finally(() => {
      closing = undefined;
    });
  await closing;
  return true;
};

const sendOffscreenMessage = async <T extends OffscreenMessage>(req: InternalRequest<T>) =>
  chrome.runtime.sendMessage<InternalRequest<T>, InternalResponse<T> | undefined>(req).then(res => {
    if (res == null) {
      // no listener in the document handled this message type
      throw new ConnectError(`Offscreen document did not handle ${req.type}`, Code.Unimplemented);
    }
    if ('error' in res) {
      throw errorFromJson(res.error, undefined, ConnectError.from(res));
    }
    return res.data;
  });

/**
 * Build actions in parallel, in an offscreen window where we can run wasm.
 * @param cancel Promise that rejects if the build should be cancelled, usually auth denial.
 * @returns An independently-promised list of action build results.
 */
const buildActions = (
  transactionPlan: TransactionPlan,
  witness: WitnessData,
  fullViewingKey: FullViewingKey,
  cancel: PromiseLike<never>,
): Promise<Action>[] => {
  const activation = activateOffscreen();

  // this json serialization involves a lot of binary -> base64 which is slow,
  // so just do it once and reuse
  const partialRequest = {
    transactionPlan: transactionPlan.toJson() as Jsonified<TransactionPlan>,
    witness: witness.toJson() as Jsonified<WitnessData>,
    fullViewingKey: fullViewingKey.toJson() as Jsonified<FullViewingKey>,
  };

  const buildTasks = transactionPlan.actions.map(async (_, actionPlanIndex) => {
    const buildReq: InternalRequest<ActionBuildMessage> = {
      type: 'BUILD_ACTION',
      request: {
        ...partialRequest,
        actionPlanIndex,
      },
    };

    // wait for offscreen to finish standing up
    await activation;

    const buildRes = await sendOffscreenMessage(buildReq);
    return Action.fromJson(buildRes);
  });

  // suppress 'unhandled promise' logs - cancellation is conveyed by the caller's own race.
  void Promise.resolve(cancel).then(undefined, () => undefined);

  // release only once every task has settled in the document (a cancelled
  // build keeps running there; releasing early could let idle-close kill it)
  // (a failed activation has already released itself)
  void activation.then(
    () => Promise.allSettled(buildTasks).then(() => releaseOffscreen()),
    () => undefined,
  );

  return buildTasks;
};

/**
 * Build a complete transaction in parallel using rayon thread pool.
 * All actions are built concurrently in WASM via rayon's par_iter().
 *
 * Requires SharedArrayBuffer support (available in Chrome extensions).
 * Needs authorization data up front; prefer {@link proveParallelWithRayon}
 * so proving can overlap user approval.
 */
const buildParallelWithRayon = async (
  transactionPlan: TransactionPlan,
  witness: WitnessData,
  fullViewingKey: FullViewingKey,
  authData: AuthorizationData,
): Promise<Transaction> => {
  const start = performance.now();
  await activateOffscreen();
  logDuration('offscreen ready (build)', start);

  try {
    const buildReq: InternalRequest<ParallelBuildMessage> = {
      type: 'BUILD_PARALLEL',
      request: {
        transactionPlan: transactionPlan.toJson() as Jsonified<TransactionPlan>,
        witness: witness.toJson() as Jsonified<WitnessData>,
        fullViewingKey: fullViewingKey.toJson() as Jsonified<FullViewingKey>,
        authData: authData.toJson() as Jsonified<AuthorizationData>,
      },
    };

    const buildRes = await sendOffscreenMessage(buildReq);
    return Transaction.fromJson(buildRes);
  } finally {
    releaseOffscreen();
    logDuration('BUILD_PARALLEL round-trip', start);
  }
};

/**
 * Prove all actions of a plan concurrently (rayon) in the offscreen document,
 * WITHOUT authorization data. Proofs need only the FVK and witness, so this
 * can start while the approval prompt is still open. The returned actions are
 * unauthorized; assemble them with `buildParallel(actions, plan, witness,
 * authData)` once approval has produced the AuthorizationData.
 *
 * Rejects with Code.Unimplemented if the offscreen document / wasm build does
 * not support proving without auth (caller should fall back).
 */
const proveParallelWithRayon = async (
  transactionPlan: TransactionPlan,
  witness: WitnessData,
  fullViewingKey: FullViewingKey,
): Promise<Action[]> => {
  const start = performance.now();
  await activateOffscreen();
  logDuration('offscreen ready (prove)', start);

  try {
    const proveReq: InternalRequest<ParallelProveMessage> = {
      type: 'PROVE_PARALLEL',
      request: {
        transactionPlan: transactionPlan.toJson() as Jsonified<TransactionPlan>,
        witness: witness.toJson() as Jsonified<WitnessData>,
        fullViewingKey: fullViewingKey.toJson() as Jsonified<FullViewingKey>,
      },
    };

    const proveRes = await sendOffscreenMessage(proveReq);
    const actions = proveRes.map(action => Action.fromJson(action));
    if (actions.length !== transactionPlan.actions.length) {
      throw new ConnectError(
        `Offscreen prover returned ${actions.length} actions for a ${transactionPlan.actions.length}-action plan`,
        Code.Internal,
      );
    }
    return actions;
  } finally {
    // released only when the document has finished the job
    releaseOffscreen();
    logDuration('PROVE_PARALLEL round-trip', start);
  }
};

/**
 * Only the service worker may decide to close the document: it is the context
 * that owns `active`. A popup or the offscreen document itself also imports
 * this module (via the services bundle) but must never act on idle nudges.
 */
const isServiceWorkerContext = () => {
  const swScope = (globalThis as { ServiceWorkerGlobalScope?: abstract new () => unknown })
    .ServiceWorkerGlobalScope;
  return typeof swScope === 'function' && globalThis instanceof swScope;
};

// Registered at module evaluation (service worker startup) so the offscreen
// document's idle nudge can wake the service worker and be handled even after
// the SW was torn down and restarted.
if ('chrome' in globalThis && isServiceWorkerContext()) {
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (
      msg != null &&
      typeof msg === 'object' &&
      'type' in msg &&
      msg.type === OFFSCREEN_IDLE_MSG
    ) {
      void closeIfIdle();
    }
    // never respond; other listeners may handle other messages
    return false;
  });
}

export const offscreenClient = {
  buildActions,
  buildParallelWithRayon,
  proveParallelWithRayon,
  touch,
  closeIfIdle,
};

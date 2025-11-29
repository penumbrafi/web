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
import { ConnectError } from '@connectrpc/connect';
import { FullViewingKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { offscreenClient } from '../../offscreen-client.js';

/**
 * Check if parallel build is available (SharedArrayBuffer support).
 * The actual WASM initialization happens in the offscreen worker.
 */
export const isParallelBuildAvailable = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined';
};

/**
 * Optimistic parallel build using rayon via offscreen worker.
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
): AsyncGenerator<PartialMessage<AuthorizeAndBuildResponse | WitnessAndBuildResponse>> {
  // Cancel promise for auth denial
  const cancel = new Promise<never>(
    (_, reject) =>
      void Promise.resolve(authorizationRequest).catch((r: unknown) =>
        reject(ConnectError.from(r)),
      ),
  );

  yield {
    status: {
      case: 'buildProgress',
      value: { progress: 0.1 },
    },
  };

  // Wait for auth
  const authData = await Promise.race([cancel, authorizationRequest]);

  // Yield immediately after auth to show progress is starting
  yield {
    status: {
      case: 'buildProgress',
      value: { progress: 0.15 },
    },
  };

  // Build all actions in parallel using rayon via offscreen worker
  // The worker handles WASM initialization and proving key loading
  const buildPromise = offscreenClient.buildParallelWithRayon(
    transactionPlan,
    witnessData,
    fvk,
    authData,
  );

  // Smooth progress animation while build runs
  // Most time is WASM init (~1-2s) + proving (~0.5-2s depending on actions)
  const startTime = Date.now();

  // Use a flag that only gets set after we check it
  let done = false;
  const buildResult = buildPromise.then(tx => {
    done = true;
    return tx;
  });

  // Always yield at least a few progress updates for smooth UX
  while (!done) {
    const elapsed = Date.now() - startTime;
    // Logarithmic progress curve: starts at 0.2, approaches 0.9 asymptotically
    const progress = 0.2 + 0.7 * (1 - 1 / (1 + elapsed / 500));

    yield {
      status: {
        case: 'buildProgress',
        value: { progress: Math.min(0.9, progress) },
      },
    };

    // Wait 60ms or until build completes
    const timeout = new Promise<void>(r => setTimeout(r, 60));
    await Promise.race([buildResult.then(() => {}), timeout]);
  }

  // Final progress before complete
  yield {
    status: {
      case: 'buildProgress',
      value: { progress: 0.95 },
    },
  };

  const transaction = await Promise.race([cancel, buildResult]);

  yield {
    status: {
      case: 'complete',
      value: { transaction },
    },
  };
};

import {
  Action,
  AuthorizationData,
  Transaction,
  TransactionPlan,
  WitnessData,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import type { StateCommitmentTree } from '@penumbra-zone/types/state-commitment-tree';
import {
  authorize,
  build_action,
  build_parallel,
  load_proving_key as load_proving_key_wasm,
  witness,
} from '../wasm/index.js';
import { FullViewingKey, SpendKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';

export const authorizePlan = (spendKey: SpendKey, txPlan: TransactionPlan): AuthorizationData => {
  const result = authorize(spendKey.toBinary(), txPlan.toBinary());
  return AuthorizationData.fromBinary(result);
};

export const getWitness = (txPlan: TransactionPlan, sct: StateCommitmentTree): WitnessData => {
  const result = witness(txPlan.toBinary(), sct);
  return WitnessData.fromBinary(result);
};

export const buildParallel = (
  batchActions: Action[],
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  authData: AuthorizationData,
): Transaction => {
  const result = build_parallel(
    batchActions.map(action => action.toJson()),
    txPlan.toBinary(),
    witnessData.toBinary(),
    authData.toBinary(),
  );
  return Transaction.fromBinary(result);
};

export const buildActionParallel = async (
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  fullViewingKey: FullViewingKey,
  actionId: number,
  keyPath?: string,
): Promise<Action> => {
  // Conditionally read proving keys from disk and load keys into WASM binary
  const actionPlan = txPlan.actions[actionId];
  if (!actionPlan?.action.case) {
    throw new Error('No action key provided');
  }

  // Remapping only for the proving-key loader
  const actionCase =
    actionPlan.action.case === 'positionOpenPlan' ? 'positionOpen' : actionPlan.action.case;

  if (keyPath) {
    await loadProvingKeyFromPath(actionCase, keyPath);
  }

  const result = build_action(
    txPlan.toBinary(),
    actionPlan.toBinary(),
    fullViewingKey.toBinary(),
    witnessData.toBinary(),
  );

  return Action.fromBinary(result);
};

/**
 * Load a proving key into the WASM module.
 * Must be called before building actions that require ZK proofs.
 */
export const loadProvingKey = (key: Uint8Array, actionType: string): void => {
  load_proving_key_wasm(key, actionType);
};

/**
 * Helper to load a proving key from a URL path.
 */
export const loadProvingKeyFromPath = async (
  actionType: Exclude<Action['action']['case'], undefined>,
  keyPath: string,
): Promise<void> => {
  const key = new Uint8Array(await (await fetch(keyPath)).arrayBuffer());
  load_proving_key_wasm(key, actionType);
};

/**
 * Build a transaction with rayon parallel action building.
 * Requires SharedArrayBuffer and initWasmWithParallel() to be called first.
 *
 * This dynamically loads the parallel WASM module and builds all actions
 * concurrently using rayon's par_iter(), which is significantly faster for
 * transactions with multiple actions.
 */
export const buildWithRayon = async (
  fullViewingKey: FullViewingKey,
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  authData: AuthorizationData,
): Promise<Transaction> => {
  // Dynamically import parallel WASM to avoid loading at module level
  const parallelWasm = await import('../wasm-parallel/index.js');

  const result = parallelWasm.build_parallel_native(
    fullViewingKey.toBinary(),
    txPlan.toBinary(),
    witnessData.toBinary(),
    authData.toBinary(),
  );

  return Transaction.fromBinary(result);
};

/* eslint-disable @typescript-eslint/require-await -- async on purpose: a wasm error becomes a rejected promise, as callers expect */
import './instance.js';
import {
  Action,
  AuthorizationData,
  Transaction,
  TransactionBody,
  TransactionPlan,
  WitnessData,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import type { StateCommitmentTree } from '@penumbrafi/types/state-commitment-tree';
import {
  assemble_transaction,
  authorize,
  build_action,
  build_transaction,
  compute_effect_hash,
  load_proving_key as load_proving_key_wasm,
  prove_actions,
  witness,
} from '../wasm/index.js';
import { FullViewingKey, SpendKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { threadsStarted } from './init.js';

/**
 * Sign a plan with the spend key.
 *
 * Refuses to run in a context that started a thread pool. Proving needs only
 * the full viewing key and the witness, so the spend key has no reason to be
 * in the prover's memory, which is shared with every pool thread and is the
 * context with the most timing exposure.
 */
export const authorizePlan = async (
  spendKey: SpendKey,
  txPlan: TransactionPlan,
): Promise<AuthorizationData> => {
  if (threadsStarted()) {
    throw new Error('authorizePlan: refusing to use the spend key in a context with a thread pool');
  }
  const result = authorize(spendKey.toBinary(), txPlan.toBinary());
  return AuthorizationData.fromBinary(result);
};

/**
 * Compute the effect hash for a transaction plan using the full viewing key.
 * Does NOT require the spend key — used for airgap signing where the spend key
 * lives on a separate device (Zigner).
 * Returns the raw 64-byte effect hash.
 */
export const computeEffectHash = async (
  fullViewingKey: FullViewingKey,
  txPlan: TransactionPlan,
): Promise<Uint8Array> =>
  new Uint8Array(compute_effect_hash(fullViewingKey.toBinary(), txPlan.toBinary()));

export const getWitness = async (
  txPlan: TransactionPlan,
  sct: StateCommitmentTree,
): Promise<WitnessData> => {
  const result = witness(txPlan.toBinary(), sct);
  return WitnessData.fromBinary(result);
};

/**
 * Build a whole transaction: every action is proven concurrently (on the
 * thread pool when this context started one), then `authData` is applied.
 */
export const buildTransaction = async (
  fullViewingKey: FullViewingKey,
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  authData: AuthorizationData,
): Promise<Transaction> => {
  const result = build_transaction(
    fullViewingKey.toBinary(),
    txPlan.toBinary(),
    witnessData.toBinary(),
    authData.toBinary(),
  );
  return Transaction.fromBinary(result);
};

/**
 * Prove every action of a plan concurrently, WITHOUT authorization data.
 *
 * Proofs only need the FVK and witness, so this can run while the user is
 * still reviewing the approval prompt. The returned actions carry no spend
 * authorization: finish with {@link assembleTransaction} once approval has
 * produced the AuthorizationData.
 */
export const proveActions = async (
  fullViewingKey: FullViewingKey,
  txPlan: TransactionPlan,
  witnessData: WitnessData,
): Promise<Action[]> => {
  const result = prove_actions(
    fullViewingKey.toBinary(),
    txPlan.toBinary(),
    witnessData.toBinary(),
  );
  return TransactionBody.fromBinary(result).actions;
};

/** Apply authorization data to actions built by {@link proveActions}. */
export const assembleTransaction = async (
  actions: Action[],
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  authData: AuthorizationData,
): Promise<Transaction> => {
  const result = assemble_transaction(
    actions.map(action => action.toJson()),
    txPlan.toBinary(),
    witnessData.toBinary(),
    authData.toBinary(),
  );
  return Transaction.fromBinary(result);
};

/** Build (prove) one action of a plan, without authorization data. */
export const buildAction = async (
  txPlan: TransactionPlan,
  witnessData: WitnessData,
  fullViewingKey: FullViewingKey,
  actionId: number,
  keyPath?: string,
): Promise<Action> => {
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
export const loadProvingKey = async (key: Uint8Array, actionType: string): Promise<void> => {
  load_proving_key_wasm(key, actionType);
  return;
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

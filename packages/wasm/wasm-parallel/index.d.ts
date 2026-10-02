/* tslint:disable */
/* eslint-disable */

export class ForwardingAddrResponse {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * A noble address that will be used for registration on the noble network
   */
  noble_addr_bech32: string;
  /**
   * Byte representation of the noble forwarding address. Used for broadcasting cosmos message.
   */
  noble_addr_bytes: Uint8Array;
  /**
   * The penumbra address that a deposit to the noble address with forward to
   * Vec encoded `pb::Address`
   */
  penumbra_addr_bytes: Uint8Array;
}

export class TransparentAddrResponse {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * The raw (binary) transparent address
   */
  address: Uint8Array;
  /**
   * The t-address encoding of the transparent address
   */
  encoding: string;
}

export class TxpAndTxvBytes {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  txp: Uint8Array;
  txv: Uint8Array;
}

export class ViewServer {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create new instances of `ViewServer`
   * Function opens a connection to indexedDb
   * Arguments:
   *     full_viewing_key: `byte representation inner FullViewingKey`
   *     epoch_duration: `u64`
   *     stored_tree: `StoredTree`
   *     idb_constants: `IndexedDbConstants`
   * Returns: `ViewServer`
   */
  static new(full_viewing_key: Uint8Array, stored_tree: any, idb_constants: any): Promise<ViewServer>;
  /**
   * Create new instances of `ViewServer` from SCT frontier snapshot.
   */
  static new_snapshot(full_viewing_key: Uint8Array, idb_constants: any, compact_frontier: Uint8Array): Promise<ViewServer>;
  /**
   * Scans a chunk of the genesis block for notes that can be trial decrypted with the viewing key.
   */
  scan_genesis_chunk(start: bigint, partial_compact_block: Uint8Array, skip_trial_decrypt: boolean): Promise<void>;
  /**
   * Reconstructs the state commitment tree (SCT) from the full genesis block using
   * the genesis advice.
   */
  genesis_advice(full_compact_block: Uint8Array): Promise<boolean>;
  /**
   * Scans block for notes, swaps
   * Returns true if the block contains new notes, swaps or false if the block is empty for us
   *     compact_block: `v1::CompactBlock`
   * Scan results are saved in-memory rather than returned
   * Use `flush_updates()` to get the scan results
   * Returns: `bool`
   */
  scan_block(compact_block: Uint8Array, skip_trial_decrypt: boolean): Promise<boolean>;
  /**
   * Get new notes, swaps, SCT state updates
   * Function also clears state
   * Returns: `ScanBlockResult`
   */
  flush_updates(): any;
  /**
   * SCT root can be compared with the root obtained by GRPC and verify that there is no divergence
   * Returns: `Uint8Array representing a Root`
   */
  get_sct_root(): Uint8Array;
  /**
   * Checks if address is controlled by view server full viewing key
   */
  is_controlled_address(address: Uint8Array): boolean;
}

/**
 * authorize transaction (sign  transaction using  spend key)
 * Arguments:
 *     spend_key: `byte representation inner SpendKey`
 *     transaction_plan: `pb::TransactionPlan`
 * Returns: `pb::AuthorizationData`
 */
export function authorize(spend_key: Uint8Array, transaction_plan: Uint8Array): Uint8Array;

/**
 * Builds a planned [`Action`] specified by
 * the [`ActionPlan`] in a [`TransactionPlan`].
 * Arguments:
 *     transaction_plan: `TransactionPlan`
 *     action_plan: `ActionPlan`
 *     full_viewing_key: `FullViewingKey`
 *     witness_data: `WitnessData``
 * Returns: `Action`
 */
export function build_action(transaction_plan: Uint8Array, action_plan: Uint8Array, full_viewing_key: Uint8Array, witness_data: Uint8Array): Uint8Array;

/**
 * Build (prove) every action of a transaction plan concurrently with rayon,
 * WITHOUT authorization data.
 *
 * This is the expensive part of transaction building (one ZK proof per
 * action) and needs only the full viewing key and witness, so callers can
 * start it as soon as the plan is ready -- e.g. while the user is still
 * looking at the approval prompt. The result carries no spend authorization;
 * it must be assembled with [`build_parallel`] (which applies the
 * `AuthorizationData`) before it is a valid transaction.
 *
 * Requires the `parallel` feature and `initThreadPool()` to be called first.
 *
 * Arguments:
 *     full_viewing_key: `FullViewingKey`
 *     transaction_plan: `TransactionPlan`
 *     witness_data: `WitnessData`
 * Returns: `TransactionBody` bytes whose `actions` field holds the built
 *     actions in plan order (all other fields are unset). A proto container
 *     is used so the result survives the JSON hops between worker, offscreen
 *     document and service worker without serde/JsValue representation issues.
 */
export function build_actions_native(full_viewing_key: Uint8Array, transaction_plan: Uint8Array, witness_data: Uint8Array): Uint8Array;

/**
 * Build parallel tx –
 * building a transaction may take some time,
 * depending on CPU performance and number of
 * actions in the transaction plan.
 * Arguments:
 *     actions: `Vec<Actions>`
 *     transaction_plan: `TransactionPlan`
 *     witness_data: `WitnessData`
 *     auth_data: `AuthorizationData`
 * Returns: `Transaction`
 */
export function build_parallel(actions: any, transaction_plan: Uint8Array, witness_data: Uint8Array, auth_data: Uint8Array): Uint8Array;

/**
 * Build transaction with rayon parallel action building.
 * Requires the `parallel` feature and `initThreadPool()` to be called first.
 *
 * This builds all actions concurrently using rayon's par_iter(), which is
 * significantly faster for transactions with multiple actions (e.g., swaps,
 * multi-output sends) because ZK proof generation happens in parallel.
 *
 * Prefer [`build_actions_native`] + [`build_parallel`] when authorization
 * arrives later than the plan (it lets proving overlap user approval).
 *
 * Arguments:
 *     full_viewing_key: `FullViewingKey`
 *     transaction_plan: `TransactionPlan`
 *     witness_data: `WitnessData`
 *     auth_data: `AuthorizationData`
 * Returns: `Transaction`
 */
export function build_parallel_native(full_viewing_key: Uint8Array, transaction_plan: Uint8Array, witness_data: Uint8Array, auth_data: Uint8Array): Uint8Array;

/**
 * Build serial tx –
 * building a transaction may take some time,
 * depending on CPU performance and number of actions
 * in the transaction plan.
 * Arguments:
 *     full_viewing_key: `FullViewingKey`
 *     transaction_plan: `TransactionPlan`
 *     witness_data: `WitnessData`
 *     auth_data: `AuthorizationData`
 * Returns: `Transaction`
 */
export function build_serial(full_viewing_key: Uint8Array, transaction_plan: Uint8Array, witness_data: Uint8Array, auth_data: Uint8Array): Uint8Array;

/**
 * Compute the effect hash for a transaction plan using the full viewing key.
 * Does NOT require the spend key — used for airgap signing where the spend key
 * lives on a separate device (Zigner).
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     transaction_plan: `pb::TransactionPlan`
 * Returns: `EffectHash` (64 bytes)
 */
export function compute_effect_hash(full_viewing_key: Uint8Array, transaction_plan: Uint8Array): Uint8Array;

/**
 * compute position id
 * Arguments:
 *     position: `Uint8Array representing a Position`
 * Returns: ` Uint8Array representing a PositionId`
 */
export function compute_position_id(position: Uint8Array): Uint8Array;

/**
 * Given a binary-encoded `Metadata`, returns a new binary-encoded `Metadata`
 * with the symbol customized if the token is one of several specific types
 * that don't have built-in symbols.
 */
export function customize_symbol(metadata_bytes: Uint8Array): Uint8Array;

/**
 * decrypt position metadata
 * Arguments:
 *     full viewing key,
 *     position metadata: `Uint8Array representing an `PositionMetadata` ciphertext object`
 * Returns: ` Uint8Array representing decrypted position metadata`
 */
export function decrypt_position_metadata(full_viewing_key: Uint8Array, position_metadata: Uint8Array): Uint8Array;

/**
 * generate a spend key from a seed phrase
 * Arguments:
 *     seed_phrase: `string`
 * Returns: `Uint8Array representing inner SpendKey`
 */
export function generate_spend_key(seed_phrase: string): Uint8Array;

/**
 * get address by index using FVK
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     account: `u32`
 *     randomizer: `12 bytes, with 0 bytes representing all 0s implicitly`
 * Returns: `Uint8Array representing inner Address`
 */
export function get_address_by_index(full_viewing_key: Uint8Array, account: number, randomizer: Uint8Array): Uint8Array;

/**
 * generate the appropriate AssetId for a binary-serialized protobuf
 * `AssetId` potentially containing an `altBaseDenom` or `altBech32m` string
 * field
 *
 * Arguments:
 *     input_id_bin: `Uint8Array` representing a binary-serialized `AssetId`
 *
 * Returns:
 *     `Uint8Array` representing a binary-serialized `AssetId`
 */
export function get_asset_id(input_id_bin: Uint8Array): Uint8Array;

/**
 * Given a `Uint8Array` encoding of a `DutchAuctionDescription`, returns that
 * auction's ID.
 */
export function get_auction_id(description: Uint8Array): Uint8Array;

/**
 * Given a `Uint8Array` encoding of an `AuctionId` (along with a sequence
 * number), returns the metadata for the auction NFT describing that auction
 * and its current sequence number.
 */
export function get_auction_nft_metadata(auction_id: Uint8Array, seq: bigint): Uint8Array;

/**
 * get delegation asset by validator identity key
 * Arguments:
 *     validator_identity_key: `penumbra_stake::IdentityKey`
 * Returns: `Uint8Array` representing a `Metadata`
 */
export function get_delegation_asset(validator_identity_key: Uint8Array): Uint8Array;

/**
 * get ephemeral (randomizer) address using FVK
 * The derivation tree is like "spend key / address index / ephemeral address" so we must also pass index as an argument
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     index: `u32`
 * Returns: `Uint8Array representing inner Address`
 */
export function get_ephemeral_address(full_viewing_key: Uint8Array, index: number): Uint8Array;

/**
 * get full viewing key from spend key
 * Arguments:
 *     spend_key: `byte representation inner SpendKey`
 * Returns: `Uint8Array representing inner FullViewingKey`
 */
export function get_full_viewing_key(spend_key: Uint8Array): Uint8Array;

/**
 * Returns the AddressIndex of an address.
 * If it is not controlled by the FVK, it returns a `None`
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     address: `byte representation inner Address`
 * Returns: `Option<AddressIndex>`
 */
export function get_index_by_address(full_viewing_key: Uint8Array, address: Uint8Array): any;

/**
 * get LP NFT asset
 * Arguments:
 *     position_value: `lp::position::Position`
 *     position_state: `lp::position::State`
 * Returns: `Uint8Array` representing a `Metadata`
 */
export function get_lpnft_asset(position_id: Uint8Array, position_state: Uint8Array): Uint8Array;

/**
 * Generates an address that can be used as a forwarding address for Noble
 * Returns: Uint8Array representing encoded Address
 */
export function get_noble_forwarding_addr(sequence: number, full_viewing_key: Uint8Array, channel: string, account?: number | null): ForwardingAddrResponse;

/**
 * get transmission key (public key for this payment address)
 * Arguments:
 *     address: `byte representation inner Address`
 * Returns: `Uint8Array representing inner Address`
 */
export function get_transmission_key_by_address(address: Uint8Array): Uint8Array;

/**
 * Returns the "truncated" address (t-addr) associated with the account.
 */
export function get_transparent_address(full_viewing_key: Uint8Array): TransparentAddrResponse;

/**
 * Utility for requesting voting notes.
 */
export function get_voting_notes(address_index: Uint8Array, votable_at_height: bigint, idb_constants: any): Promise<any>;

/**
 * Wallet id: the hash of a full viewing key, used as an account identifier
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 * Returns: `WalletId`
 */
export function get_wallet_id(full_viewing_key: Uint8Array): Uint8Array;

export function initThreadPool(num_threads: number): Promise<any>;

/**
 * Checks if address is controlled by full viewing key provided
 */
export function is_controlled_address(full_viewing_key: Uint8Array, address: Uint8Array): boolean;

/**
 * Loads the proving key as a collection of bytes, and to sets the keys in memory
 * dynamicaly at runtime. Failure to bundle the proving keys in the wasm binary
 * or call the load function will fail to generate a proof. Consumers of this
 * function will additionally require downloading the proving key parameter `.bin`
 * file for each key type.
 */
export function load_proving_key(key: Uint8Array, key_type: string): void;

/**
 * Process a `TransactionPlannerRequest`, returning a `TransactionPlan`
 */
export function plan_transaction(idb_constants: any, request: Uint8Array, full_viewing_key: Uint8Array, gas_fee_token: Uint8Array): Promise<any>;

export function sct_position(block_height: bigint, epoch_bytes: Uint8Array): bigint;

/**
 * Get transaction perspective, transaction view
 * Arguments:
 *     full_viewing_key: `FullViewingKey` inner bytes
 *     tx: Binary-encoded `Transaction` message
 *     idb_constants: IndexedDbConstants
 * Returns: `{ txp: Uint8Array, txv: Uint8Array }` representing binary-encoded `TransactionPerspective` and `TransactionView`
 */
export function transaction_perspective_and_view(full_viewing_key: Uint8Array, tx: Uint8Array, idb_constants: any): Promise<TxpAndTxvBytes>;

export function transaction_summary(txv: Uint8Array): Promise<Uint8Array>;

export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  numThreads(): number;
  receiver(): number;
  build(): void;
}

export function wbg_rayon_start_worker(receiver: number): void;

/**
 * Get witness data
 * Obtaining witness data is directly related to SCT so we need to pass the tree data
 * Arguments:
 *     transaction_plan: `pb::TransactionPlan`
 *     stored_tree: `StoredTree`
 * Returns: `pb::WitnessData`
 */
export function witness(transaction_plan: Uint8Array, stored_tree: any): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly get_asset_id: (a: number, b: number) => [number, number, number, number];
  readonly get_auction_id: (a: number, b: number) => [number, number, number, number];
  readonly get_auction_nft_metadata: (a: number, b: number, c: bigint) => [number, number, number, number];
  readonly build_action: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly build_serial: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly build_parallel: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
  readonly build_actions_native: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly build_parallel_native: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly compute_position_id: (a: number, b: number) => [number, number, number, number];
  readonly get_lpnft_asset: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly decrypt_position_metadata: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly load_proving_key: (a: number, b: number, c: number, d: number) => [number, number];
  readonly generate_spend_key: (a: number, b: number) => [number, number, number, number];
  readonly get_full_viewing_key: (a: number, b: number) => [number, number, number, number];
  readonly get_wallet_id: (a: number, b: number) => [number, number, number, number];
  readonly get_address_by_index: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
  readonly get_ephemeral_address: (a: number, b: number, c: number) => [number, number, number, number];
  readonly get_index_by_address: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly is_controlled_address: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly __wbg_forwardingaddrresponse_free: (a: number, b: number) => void;
  readonly __wbg_get_forwardingaddrresponse_noble_addr_bech32: (a: number) => [number, number];
  readonly __wbg_set_forwardingaddrresponse_noble_addr_bech32: (a: number, b: number, c: number) => void;
  readonly __wbg_get_forwardingaddrresponse_noble_addr_bytes: (a: number) => [number, number];
  readonly __wbg_set_forwardingaddrresponse_noble_addr_bytes: (a: number, b: number, c: number) => void;
  readonly __wbg_get_forwardingaddrresponse_penumbra_addr_bytes: (a: number) => [number, number];
  readonly __wbg_set_forwardingaddrresponse_penumbra_addr_bytes: (a: number, b: number, c: number) => void;
  readonly get_noble_forwarding_addr: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly __wbg_transparentaddrresponse_free: (a: number, b: number) => void;
  readonly __wbg_get_transparentaddrresponse_address: (a: number) => [number, number];
  readonly __wbg_set_transparentaddrresponse_address: (a: number, b: number, c: number) => void;
  readonly __wbg_get_transparentaddrresponse_encoding: (a: number) => [number, number];
  readonly __wbg_set_transparentaddrresponse_encoding: (a: number, b: number, c: number) => void;
  readonly get_transparent_address: (a: number, b: number) => [number, number, number];
  readonly get_transmission_key_by_address: (a: number, b: number) => [number, number, number, number];
  readonly customize_symbol: (a: number, b: number) => [number, number, number, number];
  readonly plan_transaction: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => any;
  readonly get_delegation_asset: (a: number, b: number) => [number, number, number, number];
  readonly sct_position: (a: bigint, b: number, c: number) => [bigint, number, number];
  readonly authorize: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly compute_effect_hash: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly witness: (a: number, b: number, c: any) => [number, number, number, number];
  readonly __wbg_txpandtxvbytes_free: (a: number, b: number) => void;
  readonly transaction_perspective_and_view: (a: number, b: number, c: number, d: number, e: any) => any;
  readonly transaction_summary: (a: number, b: number) => any;
  readonly __wbg_viewserver_free: (a: number, b: number) => void;
  readonly viewserver_new: (a: number, b: number, c: any, d: any) => any;
  readonly viewserver_new_snapshot: (a: number, b: number, c: any, d: number, e: number) => any;
  readonly viewserver_scan_genesis_chunk: (a: number, b: bigint, c: number, d: number, e: number) => any;
  readonly viewserver_genesis_advice: (a: number, b: number, c: number) => any;
  readonly viewserver_scan_block: (a: number, b: number, c: number, d: number) => any;
  readonly viewserver_flush_updates: (a: number) => [number, number, number];
  readonly viewserver_get_sct_root: (a: number) => [number, number, number, number];
  readonly viewserver_is_controlled_address: (a: number, b: number, c: number) => [number, number, number];
  readonly get_voting_notes: (a: number, b: number, c: bigint, d: any) => any;
  readonly __wbg_set_txpandtxvbytes_txp: (a: number, b: number, c: number) => void;
  readonly __wbg_set_txpandtxvbytes_txv: (a: number, b: number, c: number) => void;
  readonly __wbg_get_txpandtxvbytes_txp: (a: number) => [number, number];
  readonly __wbg_get_txpandtxvbytes_txv: (a: number) => [number, number];
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h7dcf9c60e9f2743a: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h216793dce1995a54: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h11dfe1dc9182c2f0: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h17034578121f47bb: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hc6c97ac99e9f3718: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h46399c5042f18d2c: (a: number, b: number, c: any, d: any) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;

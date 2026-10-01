import { startWorkers } from './snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js';

let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.dtor(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        try {
            return f(state.a, state.b, ...args);
        } finally {
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : undefined);
if (cachedTextDecoder) cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined);

if (cachedTextEncoder) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

function wasm_bindgen__convert__closures_____invoke__hc6c97ac99e9f3718(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__hc6c97ac99e9f3718(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h7dcf9c60e9f2743a(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h7dcf9c60e9f2743a(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h11dfe1dc9182c2f0(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h11dfe1dc9182c2f0(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h46399c5042f18d2c(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h46399c5042f18d2c(arg0, arg1, arg2, arg3);
}

const __wbindgen_enum_IdbCursorDirection = ["next", "nextunique", "prev", "prevunique"];

const __wbindgen_enum_IdbRequestReadyState = ["pending", "done"];

const __wbindgen_enum_IdbTransactionMode = ["readonly", "readwrite", "versionchange", "readwriteflush", "cleanup"];

const ForwardingAddrResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_forwardingaddrresponse_free(ptr >>> 0, 1));

const TransparentAddrResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_transparentaddrresponse_free(ptr >>> 0, 1));

const TxpAndTxvBytesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_txpandtxvbytes_free(ptr >>> 0, 1));

const ViewServerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_viewserver_free(ptr >>> 0, 1));

const wbg_rayon_PoolBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wbg_rayon_poolbuilder_free(ptr >>> 0, 1));

export class ForwardingAddrResponse {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ForwardingAddrResponse.prototype);
        obj.__wbg_ptr = ptr;
        ForwardingAddrResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ForwardingAddrResponseFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_forwardingaddrresponse_free(ptr, 0);
    }
    /**
     * A noble address that will be used for registration on the noble network
     * @returns {string}
     */
    get noble_addr_bech32() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_forwardingaddrresponse_noble_addr_bech32(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * A noble address that will be used for registration on the noble network
     * @param {string} arg0
     */
    set noble_addr_bech32(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_forwardingaddrresponse_noble_addr_bech32(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Byte representation of the noble forwarding address. Used for broadcasting cosmos message.
     * @returns {Uint8Array}
     */
    get noble_addr_bytes() {
        const ret = wasm.__wbg_get_forwardingaddrresponse_noble_addr_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Byte representation of the noble forwarding address. Used for broadcasting cosmos message.
     * @param {Uint8Array} arg0
     */
    set noble_addr_bytes(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_forwardingaddrresponse_noble_addr_bytes(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The penumbra address that a deposit to the noble address with forward to
     * Vec encoded `pb::Address`
     * @returns {Uint8Array}
     */
    get penumbra_addr_bytes() {
        const ret = wasm.__wbg_get_forwardingaddrresponse_penumbra_addr_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The penumbra address that a deposit to the noble address with forward to
     * Vec encoded `pb::Address`
     * @param {Uint8Array} arg0
     */
    set penumbra_addr_bytes(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_forwardingaddrresponse_penumbra_addr_bytes(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) ForwardingAddrResponse.prototype[Symbol.dispose] = ForwardingAddrResponse.prototype.free;

export class TransparentAddrResponse {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TransparentAddrResponse.prototype);
        obj.__wbg_ptr = ptr;
        TransparentAddrResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TransparentAddrResponseFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_transparentaddrresponse_free(ptr, 0);
    }
    /**
     * The raw (binary) transparent address
     * @returns {Uint8Array}
     */
    get address() {
        const ret = wasm.__wbg_get_transparentaddrresponse_address(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The raw (binary) transparent address
     * @param {Uint8Array} arg0
     */
    set address(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_transparentaddrresponse_address(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The t-address encoding of the transparent address
     * @returns {string}
     */
    get encoding() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_transparentaddrresponse_encoding(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The t-address encoding of the transparent address
     * @param {string} arg0
     */
    set encoding(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_transparentaddrresponse_encoding(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) TransparentAddrResponse.prototype[Symbol.dispose] = TransparentAddrResponse.prototype.free;

export class TxpAndTxvBytes {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TxpAndTxvBytes.prototype);
        obj.__wbg_ptr = ptr;
        TxpAndTxvBytesFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TxpAndTxvBytesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_txpandtxvbytes_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    get txp() {
        const ret = wasm.__wbg_get_txpandtxvbytes_txp(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {Uint8Array} arg0
     */
    set txp(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_transparentaddrresponse_address(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Uint8Array}
     */
    get txv() {
        const ret = wasm.__wbg_get_txpandtxvbytes_txv(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {Uint8Array} arg0
     */
    set txv(arg0) {
        const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_forwardingaddrresponse_noble_addr_bytes(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) TxpAndTxvBytes.prototype[Symbol.dispose] = TxpAndTxvBytes.prototype.free;

export class ViewServer {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ViewServer.prototype);
        obj.__wbg_ptr = ptr;
        ViewServerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ViewServerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_viewserver_free(ptr, 0);
    }
    /**
     * Create new instances of `ViewServer`
     * Function opens a connection to indexedDb
     * Arguments:
     *     full_viewing_key: `byte representation inner FullViewingKey`
     *     epoch_duration: `u64`
     *     stored_tree: `StoredTree`
     *     idb_constants: `IndexedDbConstants`
     * Returns: `ViewServer`
     * @param {Uint8Array} full_viewing_key
     * @param {any} stored_tree
     * @param {any} idb_constants
     * @returns {Promise<ViewServer>}
     */
    static new(full_viewing_key, stored_tree, idb_constants) {
        const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_new(ptr0, len0, stored_tree, idb_constants);
        return ret;
    }
    /**
     * Create new instances of `ViewServer` from SCT frontier snapshot.
     * @param {Uint8Array} full_viewing_key
     * @param {any} idb_constants
     * @param {Uint8Array} compact_frontier
     * @returns {Promise<ViewServer>}
     */
    static new_snapshot(full_viewing_key, idb_constants, compact_frontier) {
        const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(compact_frontier, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_new_snapshot(ptr0, len0, idb_constants, ptr1, len1);
        return ret;
    }
    /**
     * Scans a chunk of the genesis block for notes that can be trial decrypted with the viewing key.
     * @param {bigint} start
     * @param {Uint8Array} partial_compact_block
     * @param {boolean} skip_trial_decrypt
     * @returns {Promise<void>}
     */
    scan_genesis_chunk(start, partial_compact_block, skip_trial_decrypt) {
        const ptr0 = passArray8ToWasm0(partial_compact_block, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_scan_genesis_chunk(this.__wbg_ptr, start, ptr0, len0, skip_trial_decrypt);
        return ret;
    }
    /**
     * Reconstructs the state commitment tree (SCT) from the full genesis block using
     * the genesis advice.
     * @param {Uint8Array} full_compact_block
     * @returns {Promise<boolean>}
     */
    genesis_advice(full_compact_block) {
        const ptr0 = passArray8ToWasm0(full_compact_block, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_genesis_advice(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Scans block for notes, swaps
     * Returns true if the block contains new notes, swaps or false if the block is empty for us
     *     compact_block: `v1::CompactBlock`
     * Scan results are saved in-memory rather than returned
     * Use `flush_updates()` to get the scan results
     * Returns: `bool`
     * @param {Uint8Array} compact_block
     * @param {boolean} skip_trial_decrypt
     * @returns {Promise<boolean>}
     */
    scan_block(compact_block, skip_trial_decrypt) {
        const ptr0 = passArray8ToWasm0(compact_block, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_scan_block(this.__wbg_ptr, ptr0, len0, skip_trial_decrypt);
        return ret;
    }
    /**
     * Get new notes, swaps, SCT state updates
     * Function also clears state
     * Returns: `ScanBlockResult`
     * @returns {any}
     */
    flush_updates() {
        const ret = wasm.viewserver_flush_updates(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * SCT root can be compared with the root obtained by GRPC and verify that there is no divergence
     * Returns: `Uint8Array representing a Root`
     * @returns {Uint8Array}
     */
    get_sct_root() {
        const ret = wasm.viewserver_get_sct_root(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Checks if address is controlled by view server full viewing key
     * @param {Uint8Array} address
     * @returns {boolean}
     */
    is_controlled_address(address) {
        const ptr0 = passArray8ToWasm0(address, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.viewserver_is_controlled_address(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
}
if (Symbol.dispose) ViewServer.prototype[Symbol.dispose] = ViewServer.prototype.free;

/**
 * authorize transaction (sign  transaction using  spend key)
 * Arguments:
 *     spend_key: `byte representation inner SpendKey`
 *     transaction_plan: `pb::TransactionPlan`
 * Returns: `pb::AuthorizationData`
 * @param {Uint8Array} spend_key
 * @param {Uint8Array} transaction_plan
 * @returns {Uint8Array}
 */
export function authorize(spend_key, transaction_plan) {
    const ptr0 = passArray8ToWasm0(spend_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.authorize(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Builds a planned [`Action`] specified by
 * the [`ActionPlan`] in a [`TransactionPlan`].
 * Arguments:
 *     transaction_plan: `TransactionPlan`
 *     action_plan: `ActionPlan`
 *     full_viewing_key: `FullViewingKey`
 *     witness_data: `WitnessData``
 * Returns: `Action`
 * @param {Uint8Array} transaction_plan
 * @param {Uint8Array} action_plan
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} witness_data
 * @returns {Uint8Array}
 */
export function build_action(transaction_plan, action_plan, full_viewing_key, witness_data) {
    const ptr0 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(action_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(witness_data, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.build_action(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}

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
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} transaction_plan
 * @param {Uint8Array} witness_data
 * @returns {Uint8Array}
 */
export function build_actions_native(full_viewing_key, transaction_plan, witness_data) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(witness_data, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.build_actions_native(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

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
 * @param {any} actions
 * @param {Uint8Array} transaction_plan
 * @param {Uint8Array} witness_data
 * @param {Uint8Array} auth_data
 * @returns {Uint8Array}
 */
export function build_parallel(actions, transaction_plan, witness_data, auth_data) {
    const ptr0 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(witness_data, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(auth_data, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.build_parallel(actions, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

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
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} transaction_plan
 * @param {Uint8Array} witness_data
 * @param {Uint8Array} auth_data
 * @returns {Uint8Array}
 */
export function build_parallel_native(full_viewing_key, transaction_plan, witness_data, auth_data) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(witness_data, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(auth_data, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.build_parallel_native(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}

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
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} transaction_plan
 * @param {Uint8Array} witness_data
 * @param {Uint8Array} auth_data
 * @returns {Uint8Array}
 */
export function build_serial(full_viewing_key, transaction_plan, witness_data, auth_data) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(witness_data, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(auth_data, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.build_serial(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}

/**
 * Compute the effect hash for a transaction plan using the full viewing key.
 * Does NOT require the spend key — used for airgap signing where the spend key
 * lives on a separate device (Zigner).
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     transaction_plan: `pb::TransactionPlan`
 * Returns: `EffectHash` (64 bytes)
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} transaction_plan
 * @returns {Uint8Array}
 */
export function compute_effect_hash(full_viewing_key, transaction_plan) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_effect_hash(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * compute position id
 * Arguments:
 *     position: `Uint8Array representing a Position`
 * Returns: ` Uint8Array representing a PositionId`
 * @param {Uint8Array} position
 * @returns {Uint8Array}
 */
export function compute_position_id(position) {
    const ptr0 = passArray8ToWasm0(position, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compute_position_id(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Given a binary-encoded `Metadata`, returns a new binary-encoded `Metadata`
 * with the symbol customized if the token is one of several specific types
 * that don't have built-in symbols.
 * @param {Uint8Array} metadata_bytes
 * @returns {Uint8Array}
 */
export function customize_symbol(metadata_bytes) {
    const ptr0 = passArray8ToWasm0(metadata_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.customize_symbol(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * decrypt position metadata
 * Arguments:
 *     full viewing key,
 *     position metadata: `Uint8Array representing an `PositionMetadata` ciphertext object`
 * Returns: ` Uint8Array representing decrypted position metadata`
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} position_metadata
 * @returns {Uint8Array}
 */
export function decrypt_position_metadata(full_viewing_key, position_metadata) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(position_metadata, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.decrypt_position_metadata(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * generate a spend key from a seed phrase
 * Arguments:
 *     seed_phrase: `string`
 * Returns: `Uint8Array representing inner SpendKey`
 * @param {string} seed_phrase
 * @returns {Uint8Array}
 */
export function generate_spend_key(seed_phrase) {
    const ptr0 = passStringToWasm0(seed_phrase, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.generate_spend_key(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * get address by index using FVK
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     account: `u32`
 *     randomizer: `12 bytes, with 0 bytes representing all 0s implicitly`
 * Returns: `Uint8Array representing inner Address`
 * @param {Uint8Array} full_viewing_key
 * @param {number} account
 * @param {Uint8Array} randomizer
 * @returns {Uint8Array}
 */
export function get_address_by_index(full_viewing_key, account, randomizer) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(randomizer, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.get_address_by_index(ptr0, len0, account, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

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
 * @param {Uint8Array} input_id_bin
 * @returns {Uint8Array}
 */
export function get_asset_id(input_id_bin) {
    const ptr0 = passArray8ToWasm0(input_id_bin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_asset_id(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Given a `Uint8Array` encoding of a `DutchAuctionDescription`, returns that
 * auction's ID.
 * @param {Uint8Array} description
 * @returns {Uint8Array}
 */
export function get_auction_id(description) {
    const ptr0 = passArray8ToWasm0(description, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_auction_id(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Given a `Uint8Array` encoding of an `AuctionId` (along with a sequence
 * number), returns the metadata for the auction NFT describing that auction
 * and its current sequence number.
 * @param {Uint8Array} auction_id
 * @param {bigint} seq
 * @returns {Uint8Array}
 */
export function get_auction_nft_metadata(auction_id, seq) {
    const ptr0 = passArray8ToWasm0(auction_id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_auction_nft_metadata(ptr0, len0, seq);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * get delegation asset by validator identity key
 * Arguments:
 *     validator_identity_key: `penumbra_stake::IdentityKey`
 * Returns: `Uint8Array` representing a `Metadata`
 * @param {Uint8Array} validator_identity_key
 * @returns {Uint8Array}
 */
export function get_delegation_asset(validator_identity_key) {
    const ptr0 = passArray8ToWasm0(validator_identity_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_delegation_asset(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * get ephemeral (randomizer) address using FVK
 * The derivation tree is like "spend key / address index / ephemeral address" so we must also pass index as an argument
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     index: `u32`
 * Returns: `Uint8Array representing inner Address`
 * @param {Uint8Array} full_viewing_key
 * @param {number} index
 * @returns {Uint8Array}
 */
export function get_ephemeral_address(full_viewing_key, index) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_ephemeral_address(ptr0, len0, index);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * get full viewing key from spend key
 * Arguments:
 *     spend_key: `byte representation inner SpendKey`
 * Returns: `Uint8Array representing inner FullViewingKey`
 * @param {Uint8Array} spend_key
 * @returns {Uint8Array}
 */
export function get_full_viewing_key(spend_key) {
    const ptr0 = passArray8ToWasm0(spend_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_full_viewing_key(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Returns the AddressIndex of an address.
 * If it is not controlled by the FVK, it returns a `None`
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 *     address: `byte representation inner Address`
 * Returns: `Option<AddressIndex>`
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} address
 * @returns {any}
 */
export function get_index_by_address(full_viewing_key, address) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(address, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.get_index_by_address(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * get LP NFT asset
 * Arguments:
 *     position_value: `lp::position::Position`
 *     position_state: `lp::position::State`
 * Returns: `Uint8Array` representing a `Metadata`
 * @param {Uint8Array} position_id
 * @param {Uint8Array} position_state
 * @returns {Uint8Array}
 */
export function get_lpnft_asset(position_id, position_state) {
    const ptr0 = passArray8ToWasm0(position_id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(position_state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.get_lpnft_asset(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Generates an address that can be used as a forwarding address for Noble
 * Returns: Uint8Array representing encoded Address
 * @param {number} sequence
 * @param {Uint8Array} full_viewing_key
 * @param {string} channel
 * @param {number | null} [account]
 * @returns {ForwardingAddrResponse}
 */
export function get_noble_forwarding_addr(sequence, full_viewing_key, channel, account) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.get_noble_forwarding_addr(sequence, ptr0, len0, ptr1, len1, isLikeNone(account) ? 0x100000001 : (account) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ForwardingAddrResponse.__wrap(ret[0]);
}

/**
 * get transmission key (public key for this payment address)
 * Arguments:
 *     address: `byte representation inner Address`
 * Returns: `Uint8Array representing inner Address`
 * @param {Uint8Array} address
 * @returns {Uint8Array}
 */
export function get_transmission_key_by_address(address) {
    const ptr0 = passArray8ToWasm0(address, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_transmission_key_by_address(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Returns the "truncated" address (t-addr) associated with the account.
 * @param {Uint8Array} full_viewing_key
 * @returns {TransparentAddrResponse}
 */
export function get_transparent_address(full_viewing_key) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_transparent_address(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return TransparentAddrResponse.__wrap(ret[0]);
}

/**
 * Utility for requesting voting notes.
 * @param {Uint8Array} address_index
 * @param {bigint} votable_at_height
 * @param {any} idb_constants
 * @returns {Promise<any>}
 */
export function get_voting_notes(address_index, votable_at_height, idb_constants) {
    const ptr0 = passArray8ToWasm0(address_index, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_voting_notes(ptr0, len0, votable_at_height, idb_constants);
    return ret;
}

/**
 * Wallet id: the hash of a full viewing key, used as an account identifier
 * Arguments:
 *     full_viewing_key: `byte representation inner FullViewingKey`
 * Returns: `WalletId`
 * @param {Uint8Array} full_viewing_key
 * @returns {Uint8Array}
 */
export function get_wallet_id(full_viewing_key) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.get_wallet_id(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {number} num_threads
 * @returns {Promise<any>}
 */
export function initThreadPool(num_threads) {
    const ret = wasm.initThreadPool(num_threads);
    return ret;
}

/**
 * Checks if address is controlled by full viewing key provided
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} address
 * @returns {boolean}
 */
export function is_controlled_address(full_viewing_key, address) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(address, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_controlled_address(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * Loads the proving key as a collection of bytes, and to sets the keys in memory
 * dynamicaly at runtime. Failure to bundle the proving keys in the wasm binary
 * or call the load function will fail to generate a proof. Consumers of this
 * function will additionally require downloading the proving key parameter `.bin`
 * file for each key type.
 * @param {Uint8Array} key
 * @param {string} key_type
 */
export function load_proving_key(key, key_type) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(key_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.load_proving_key(ptr0, len0, ptr1, len1);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Process a `TransactionPlannerRequest`, returning a `TransactionPlan`
 * @param {any} idb_constants
 * @param {Uint8Array} request
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} gas_fee_token
 * @returns {Promise<any>}
 */
export function plan_transaction(idb_constants, request, full_viewing_key, gas_fee_token) {
    const ptr0 = passArray8ToWasm0(request, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(gas_fee_token, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.plan_transaction(idb_constants, ptr0, len0, ptr1, len1, ptr2, len2);
    return ret;
}

/**
 * @param {bigint} block_height
 * @param {Uint8Array} epoch_bytes
 * @returns {bigint}
 */
export function sct_position(block_height, epoch_bytes) {
    const ptr0 = passArray8ToWasm0(epoch_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sct_position(block_height, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return BigInt.asUintN(64, ret[0]);
}

/**
 * Get transaction perspective, transaction view
 * Arguments:
 *     full_viewing_key: `FullViewingKey` inner bytes
 *     tx: Binary-encoded `Transaction` message
 *     idb_constants: IndexedDbConstants
 * Returns: `{ txp: Uint8Array, txv: Uint8Array }` representing binary-encoded `TransactionPerspective` and `TransactionView`
 * @param {Uint8Array} full_viewing_key
 * @param {Uint8Array} tx
 * @param {any} idb_constants
 * @returns {Promise<TxpAndTxvBytes>}
 */
export function transaction_perspective_and_view(full_viewing_key, tx, idb_constants) {
    const ptr0 = passArray8ToWasm0(full_viewing_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(tx, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.transaction_perspective_and_view(ptr0, len0, ptr1, len1, idb_constants);
    return ret;
}

/**
 * @param {Uint8Array} txv
 * @returns {Promise<Uint8Array>}
 */
export function transaction_summary(txv) {
    const ptr0 = passArray8ToWasm0(txv, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.transaction_summary(ptr0, len0);
    return ret;
}

export class wbg_rayon_PoolBuilder {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(wbg_rayon_PoolBuilder.prototype);
        obj.__wbg_ptr = ptr;
        wbg_rayon_PoolBuilderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        wbg_rayon_PoolBuilderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wbg_rayon_poolbuilder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    numThreads() {
        const ret = wasm.wbg_rayon_poolbuilder_numThreads(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    receiver() {
        const ret = wasm.wbg_rayon_poolbuilder_receiver(this.__wbg_ptr);
        return ret >>> 0;
    }
    build() {
        wasm.wbg_rayon_poolbuilder_build(this.__wbg_ptr);
    }
}
if (Symbol.dispose) wbg_rayon_PoolBuilder.prototype[Symbol.dispose] = wbg_rayon_PoolBuilder.prototype.free;

/**
 * @param {number} receiver
 */
export function wbg_rayon_start_worker(receiver) {
    wasm.wbg_rayon_start_worker(receiver);
}

/**
 * Get witness data
 * Obtaining witness data is directly related to SCT so we need to pass the tree data
 * Arguments:
 *     transaction_plan: `pb::TransactionPlan`
 *     stored_tree: `StoredTree`
 * Returns: `pb::WitnessData`
 * @param {Uint8Array} transaction_plan
 * @param {any} stored_tree
 * @returns {Uint8Array}
 */
export function witness(transaction_plan, stored_tree) {
    const ptr0 = passArray8ToWasm0(transaction_plan, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.witness(ptr0, len0, stored_tree);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports(memory) {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_Error_52673b7de5a0ca89 = function(arg0, arg1) {
        const ret = Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_Number_2d1dcfcf4ec51736 = function(arg0) {
        const ret = Number(arg0);
        return ret;
    };
    imports.wbg.__wbg_String_8f0eb39a4a4c2f66 = function(arg0, arg1) {
        const ret = String(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_Window_b0044ac7db258535 = function(arg0) {
        const ret = arg0.Window;
        return ret;
    };
    imports.wbg.__wbg_WorkerGlobalScope_b74cefefc62a37da = function(arg0) {
        const ret = arg0.WorkerGlobalScope;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_bigint_get_as_i64_6e32f5e6aff02e1d = function(arg0, arg1) {
        const v = arg1;
        const ret = typeof(v) === 'bigint' ? v : undefined;
        getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_boolean_get_dea25b33882b895b = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? v : undefined;
        return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
    };
    imports.wbg.__wbg___wbindgen_debug_string_adfb662ae34724b6 = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_in_0d3e1e8f0c669317 = function(arg0, arg1) {
        const ret = arg0 in arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_bigint_0e1a2e3f55cfae27 = function(arg0) {
        const ret = typeof(arg0) === 'bigint';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_null_dfda7d66506c95b5 = function(arg0) {
        const ret = arg0 === null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_ce774f3490692386 = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_string_704ef9c8fc131030 = function(arg0) {
        const ret = typeof(arg0) === 'string';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_eq_b6101cc9cef1fe36 = function(arg0, arg1) {
        const ret = arg0 === arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_loose_eq_766057600fdd1b0d = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_memory_a342e963fbcabd68 = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_module_967adef62ea6cbf8 = function() {
        const ret = __wbg_init.__wbindgen_wasm_module;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_number_get_9619185a74197f95 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_rethrow_78714972834ecdf1 = function(arg0) {
        throw arg0;
    };
    imports.wbg.__wbg___wbindgen_string_get_a2a31e16edf96e42 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg__wbg_cb_unref_87dfb5aaa0cbcea7 = function(arg0) {
        arg0._wbg_cb_unref();
    };
    imports.wbg.__wbg_async_39e36d0115492e54 = function(arg0) {
        const ret = arg0.async;
        return ret;
    };
    imports.wbg.__wbg_buffer_aa30bbb65cb44323 = function(arg0) {
        const ret = arg0.buffer;
        return ret;
    };
    imports.wbg.__wbg_call_41c7efaf6b1182f8 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.call(arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_call_c45d13337ffb12ac = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_crypto_ed58b8e10a292839 = function(arg0) {
        const ret = arg0.crypto;
        return ret;
    };
    imports.wbg.__wbg_data_a3dd20a4649dc6e4 = function(arg0) {
        const ret = arg0.data;
        return ret;
    };
    imports.wbg.__wbg_done_362f78ab584a24b5 = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_entries_27a445ca6b702f8d = function(arg0) {
        const ret = Object.entries(arg0);
        return ret;
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_error_dae0861a350d0654 = function() { return handleError(function (arg0) {
        const ret = arg0.error;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    }, arguments) };
    imports.wbg.__wbg_from_b4bd31c02b6d179c = function(arg0) {
        const ret = Array.from(arg0);
        return ret;
    };
    imports.wbg.__wbg_getAll_03202c9a68f2c12c = function() { return handleError(function (arg0) {
        const ret = arg0.getAll();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_getRandomValues_bcb4912f16000dc4 = function() { return handleError(function (arg0, arg1) {
        arg0.getRandomValues(arg1);
    }, arguments) };
    imports.wbg.__wbg_get_01203e6a4116a116 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_329df8534b48cf11 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.get(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_get_91d64a05814bf7f0 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.get(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_get_e7114b7bf3d9d5f5 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_get_with_ref_key_1dc361bd10053bfe = function(arg0, arg1) {
        const ret = arg0[arg1];
        return ret;
    };
    imports.wbg.__wbg_globalThis_856ff24a65e13540 = function() { return handleError(function () {
        const ret = globalThis.globalThis;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_global_b6f5c73312f62313 = function(arg0) {
        const ret = arg0.global;
        return ret;
    };
    imports.wbg.__wbg_global_fc813a897a497d26 = function() { return handleError(function () {
        const ret = global.global;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_index_85303c6c6c093a21 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.index(getStringFromWasm0(arg1, arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_indexedDB_601ec26c63e333de = function() { return handleError(function (arg0) {
        const ret = arg0.indexedDB;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    }, arguments) };
    imports.wbg.__wbg_indexedDB_680177eb67e6f858 = function() { return handleError(function (arg0) {
        const ret = arg0.indexedDB;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    }, arguments) };
    imports.wbg.__wbg_indexedDB_e4b4f3f448adf99b = function() { return handleError(function (arg0) {
        const ret = arg0.indexedDB;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    }, arguments) };
    imports.wbg.__wbg_instanceof_ArrayBuffer_8b96bf6c71691dc9 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Map_cd976ea4854c21db = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Map;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_faa8901ba56cb8e9 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Window_56b07700cf73649e = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Window;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_6836d46c89daf1b6 = function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
    };
    imports.wbg.__wbg_isSafeInteger_2fb2b4f942993af4 = function(arg0) {
        const ret = Number.isSafeInteger(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_773e0b022e7009f4 = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_0a11127664108286 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_9aaa2867670f533a = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_msCrypto_0a36e2ec3a343d26 = function(arg0) {
        const ret = arg0.msCrypto;
        return ret;
    };
    imports.wbg.__wbg_new_07527e5c188e7771 = function(arg0, arg1) {
        try {
            var state0 = {a: arg0, b: arg1};
            var cb0 = (arg0, arg1) => {
                const a = state0.a;
                state0.a = 0;
                try {
                    return wasm_bindgen__convert__closures_____invoke__h46399c5042f18d2c(a, state0.b, arg0, arg1);
                } finally {
                    state0.a = a;
                }
            };
            const ret = new Promise(cb0);
            return ret;
        } finally {
            state0.a = state0.b = 0;
        }
    };
    imports.wbg.__wbg_new_4c16aab09d1eb450 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_6e254ba4a466646d = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_new_c0d5745283f120d6 = function(arg0) {
        const ret = new Int32Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_d5f718c2118cdc06 = function() { return handleError(function (arg0, arg1) {
        const ret = new Worker(getStringFromWasm0(arg0, arg1));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_new_db41cf29086ce106 = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_no_args_29f93ce2db72cd07 = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_with_byte_offset_and_length_c8ea72df7687880b = function(arg0, arg1, arg2) {
        const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_new_with_length_60b9d756f80003a6 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_next_95ee887e1f50209d = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_next_b2690a2dab163f0f = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_node_02999533c4ea02e3 = function(arg0) {
        const ret = arg0.node;
        return ret;
    };
    imports.wbg.__wbg_objectStore_13a5bd2f1e61cc09 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_of_5295e03c6fde0567 = function(arg0, arg1, arg2) {
        const ret = Array.of(arg0, arg1, arg2);
        return ret;
    };
    imports.wbg.__wbg_openCursor_04c643372feb48f8 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.openCursor(arg1, __wbindgen_enum_IdbCursorDirection[arg2]);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_open_aa35d795d5b141a6 = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_postMessage_348f08a293dccb82 = function() { return handleError(function (arg0, arg1) {
        arg0.postMessage(arg1);
    }, arguments) };
    imports.wbg.__wbg_process_5c1d670bc53614b8 = function(arg0) {
        const ret = arg0.process;
        return ret;
    };
    imports.wbg.__wbg_put_f819663f2cce1da5 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.put(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_put_f9cd011c0ef39430 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.put(arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_queueMicrotask_98e746b9f850fe3d = function(arg0) {
        queueMicrotask(arg0);
    };
    imports.wbg.__wbg_queueMicrotask_c847cc8372bec908 = function(arg0) {
        const ret = arg0.queueMicrotask;
        return ret;
    };
    imports.wbg.__wbg_randomFillSync_ab2cfe79ebbf2740 = function() { return handleError(function (arg0, arg1) {
        arg0.randomFillSync(arg1);
    }, arguments) };
    imports.wbg.__wbg_readyState_9f4b2e1d4d0c25f1 = function(arg0) {
        const ret = arg0.readyState;
        return (__wbindgen_enum_IdbRequestReadyState.indexOf(ret) + 1 || 3) - 1;
    };
    imports.wbg.__wbg_require_79b1e9274cde3c87 = function() { return handleError(function () {
        const ret = module.require;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_resolve_03bf127fbf612c20 = function(arg0) {
        const ret = Promise.resolve(arg0);
        return ret;
    };
    imports.wbg.__wbg_result_da7e8ed088ac1b05 = function() { return handleError(function (arg0) {
        const ret = arg0.result;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_self_799f153b0b6e0183 = function() { return handleError(function () {
        const ret = self.self;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_set_3f1d0b984ed272ed = function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
    };
    imports.wbg.__wbg_set_e1b9d9ffeee30338 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_set_e97d203fd145cdae = function(arg0, arg1, arg2) {
        arg0.set(arg1, arg2 >>> 0);
    };
    imports.wbg.__wbg_set_onabort_b0106c045cc3e36d = function(arg0, arg1) {
        arg0.onabort = arg1;
    };
    imports.wbg.__wbg_set_onblocked_6ed7533af9db8333 = function(arg0, arg1) {
        arg0.onblocked = arg1;
    };
    imports.wbg.__wbg_set_oncomplete_6c1e418cba03876e = function(arg0, arg1) {
        arg0.oncomplete = arg1;
    };
    imports.wbg.__wbg_set_onerror_c97f5c7bc15df851 = function(arg0, arg1) {
        arg0.onerror = arg1;
    };
    imports.wbg.__wbg_set_onerror_edcd7b00caf27d4d = function(arg0, arg1) {
        arg0.onerror = arg1;
    };
    imports.wbg.__wbg_set_onmessage_42541d04d4ffeb6e = function(arg0, arg1) {
        arg0.onmessage = arg1;
    };
    imports.wbg.__wbg_set_onsuccess_c78e7a110a43f541 = function(arg0, arg1) {
        arg0.onsuccess = arg1;
    };
    imports.wbg.__wbg_set_onupgradeneeded_8a72147bf3d8700a = function(arg0, arg1) {
        arg0.onupgradeneeded = arg1;
    };
    imports.wbg.__wbg_set_onversionchange_927eda17d801df95 = function(arg0, arg1) {
        arg0.onversionchange = arg1;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_startWorkers_2ca11761e08ff5d5 = function(arg0, arg1, arg2) {
        const ret = startWorkers(arg0, arg1, wbg_rayon_PoolBuilder.__wrap(arg2));
        return ret;
    };
    imports.wbg.__wbg_subarray_a984c21c3cf98bbb = function(arg0, arg1, arg2) {
        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_target_8f11f6c47d6f15dd = function(arg0) {
        const ret = arg0.target;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_then_d88c104795b9d5aa = function(arg0, arg1) {
        const ret = arg0.then(arg1);
        return ret;
    };
    imports.wbg.__wbg_transaction_a094ab36d25baa55 = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = arg0.transaction(getStringFromWasm0(arg1, arg2), __wbindgen_enum_IdbTransactionMode[arg3]);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_transaction_f197a864f4077373 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.transaction(getStringFromWasm0(arg1, arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_txpandtxvbytes_new = function(arg0) {
        const ret = TxpAndTxvBytes.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_value_1c034ee54fc4657a = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbg_value_87c720f6568103d1 = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbg_value_dd7bd9e3cabcd482 = function() { return handleError(function (arg0) {
        const ret = arg0.value;
        return ret;
    }, arguments) };
    imports.wbg.__wbg_versions_c71aa1626a93e0a1 = function(arg0) {
        const ret = arg0.versions;
        return ret;
    };
    imports.wbg.__wbg_viewserver_new = function(arg0) {
        const ret = ViewServer.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_waitAsync_0eab8e348d3d6de8 = function() {
        const ret = Atomics.waitAsync;
        return ret;
    };
    imports.wbg.__wbg_waitAsync_5cd70a446ab580bc = function(arg0, arg1, arg2) {
        const ret = Atomics.waitAsync(arg0, arg1 >>> 0, arg2);
        return ret;
    };
    imports.wbg.__wbg_window_cd65fa4478648b49 = function() { return handleError(function () {
        const ret = window.window;
        return ret;
    }, arguments) };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_cast_4625c577ab2ec9ee = function(arg0) {
        // Cast intrinsic for `U64 -> Externref`.
        const ret = BigInt.asUintN(64, arg0);
        return ret;
    };
    imports.wbg.__wbindgen_cast_77bc3e92745e9a35 = function(arg0, arg1) {
        var v0 = getArrayU8FromWasm0(arg0, arg1).slice();
        wasm.__wbindgen_free(arg0, arg1 * 1, 1);
        // Cast intrinsic for `Vector(U8) -> Externref`.
        const ret = v0;
        return ret;
    };
    imports.wbg.__wbindgen_cast_9ae0607507abb057 = function(arg0) {
        // Cast intrinsic for `I64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_cast_a74541775b3296de = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 552, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 553, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
        const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h216793dce1995a54, wasm_bindgen__convert__closures_____invoke__h7dcf9c60e9f2743a);
        return ret;
    };
    imports.wbg.__wbindgen_cast_c263e0ea45996a7d = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 655, function: Function { arguments: [NamedExternref("Event")], shim_idx: 656, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
        const ret = makeClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h17034578121f47bb, wasm_bindgen__convert__closures_____invoke__h11dfe1dc9182c2f0);
        return ret;
    };
    imports.wbg.__wbindgen_cast_d1dd07120553c180 = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 552, function: Function { arguments: [Externref], shim_idx: 553, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
        const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h216793dce1995a54, wasm_bindgen__convert__closures_____invoke__h7dcf9c60e9f2743a);
        return ret;
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_cast_e5a08d2a3ea81a35 = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 655, function: Function { arguments: [], shim_idx: 658, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
        const ret = makeClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h17034578121f47bb, wasm_bindgen__convert__closures_____invoke__hc6c97ac99e9f3718);
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
    };
    imports.wbg.__wbindgen_link_8b58b27602368eaa = function(arg0) {
        const val = `onmessage = function (ev) {
            let [ia, index, value] = ev.data;
            ia = new Int32Array(ia.buffer);
            let result = Atomics.wait(ia, index, value);
            postMessage(result);
        };
        `;
        const ret = typeof URL.createObjectURL === 'undefined' ? "data:application/javascript," + encodeURIComponent(val) : URL.createObjectURL(new Blob([val], { type: "text/javascript" }));
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.memory = memory || new WebAssembly.Memory({initial:31,maximum:65536,shared:true});

    return imports;
}

function __wbg_finalize_init(instance, module, thread_stack_size) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;

    if (typeof thread_stack_size !== 'undefined' && (typeof thread_stack_size !== 'number' || thread_stack_size === 0 || thread_stack_size % 65536 !== 0)) { throw 'invalid stack size' }
    wasm.__wbindgen_start(thread_stack_size);
    return wasm;
}

function initSync(module, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module, memory, thread_stack_size} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports(memory);
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module, thread_stack_size);
}

async function __wbg_init(module_or_path, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path, memory, thread_stack_size} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('index_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports(memory);

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module, thread_stack_size);
}

export { initSync };
export default __wbg_init;

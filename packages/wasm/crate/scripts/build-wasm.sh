#!/bin/bash
# Build the penumbra wasm module (`pnpm build:wasm`). There is one build: threads
# (atomics + shared memory) are always on, rayon runs on a pool when the caller
# starts one and on the calling thread otherwise.
#
# cargo builds the module, wasm-bindgen generates the JS bindings
# (--target web), wasm-opt optimises it.
#
# Requirements:
#   - rust-src for the pinned toolchain (or TOOLCHAIN=nightly-YYYY-MM-DD)
#   - wasm-bindgen-cli matching Cargo.lock: cargo install wasm-bindgen-cli --version <lock version>
#   - wasm-opt (binaryen, REQUIRED)
#
# Runtime requirement: SharedArrayBuffer, i.e. a cross-origin-isolated context
# (COOP same-origin + COEP require-corp) or Node.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="${OUT_DIR:-${CRATE_DIR}/../wasm}"
# Cargo profile: speed-optimized (opt-level=3, fat LTO, 1 CGU); see Cargo.toml.
PROFILE="${PROFILE:-release-wasm}"
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"
WASM_OPT="${WASM_OPT:-wasm-opt}"
# wasm-opt level. -O3 (speed), not -Oz: this build exists to make proving fast.
WASM_OPT_LEVEL="${WASM_OPT_LEVEL:--O3}"
# Initial memory is NOT set here: the JS side (src/init.ts) constructs the shared
# WebAssembly.Memory and passes it in. Only the maximum is baked into the module
# and it must equal the JS `maximum` (65536 pages = 4 GiB). Raising the initial
# size (JS or --initial-memory) does not help: the Rust allocator only uses
# pages it obtains via memory.grow, so pre-sized pages are wasted (see init.ts).
MAX_MEMORY=4294967296

echo "Building Multi-threaded WASM with Rayon"
echo "========================================"
echo "Crate directory: $CRATE_DIR"
echo "Output directory: $OUT_DIR"
echo "Cargo profile:    $PROFILE"
echo

# Toolchain. -Z build-std needs nightly features. Floating `nightly` is NOT
# reproducible and currently fails (rustc >= ~1.89 rejects metrics 0.24.1 in
# Cargo.lock, E0521 / rust#141402). Default: the repo-pinned toolchain
# (crate/rust-toolchain.toml) with RUSTC_BOOTSTRAP=1 to unlock -Z build-std.
# Override with TOOLCHAIN=nightly-YYYY-MM-DD for a real nightly.
PINNED_TOOLCHAIN="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$CRATE_DIR/rust-toolchain.toml")"
TOOLCHAIN="${TOOLCHAIN:-$PINNED_TOOLCHAIN}"
case "$TOOLCHAIN" in
    nightly*) ;;
    *) export RUSTC_BOOTSTRAP=1 ;;
esac
echo "Toolchain:        $TOOLCHAIN${RUSTC_BOOTSTRAP:+ (RUSTC_BOOTSTRAP=1)}"
if ! rustup run "$TOOLCHAIN" rustc --print sysroot | xargs -I {} test -d "{}/lib/rustlib/src/rust"; then
    echo "Installing rust-src component for $TOOLCHAIN..."
    rustup component add rust-src --toolchain "$TOOLCHAIN"
fi

# wasm-opt is REQUIRED (not optional): an un-optimized parallel build was shipped
# before. Set SKIP_WASM_OPT=1 to bypass for local debugging only.
if [ "${SKIP_WASM_OPT:-0}" != "1" ] && ! command -v "$WASM_OPT" &>/dev/null; then
    echo "Error: wasm-opt not found (binaryen). Install it or set WASM_OPT=/path/to/wasm-opt." >&2
    exit 1
fi

# Step 1: cargo build with atomics + bulk-memory + SIMD
echo "Step 1: cargo build (atomics + bulk-memory + mutable-globals + simd128)..."
cd "$CRATE_DIR"
# NB: RUSTFLAGS overrides .cargo/config.toml rustflags wholesale, so simd128 is repeated here.
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128 -C link-arg=--max-memory=${MAX_MEMORY}" \
cargo "+$TOOLCHAIN" build \
    --lib \
    --profile "$PROFILE" \
    --target wasm32-unknown-unknown \
    -Z build-std=panic_abort,std

# Handle both crate-local and workspace-root target directories
WASM_FILE="$CRATE_DIR/target/wasm32-unknown-unknown/$PROFILE/penumbra_wasm.wasm"
if [ ! -f "$WASM_FILE" ]; then
    WASM_FILE="$CRATE_DIR/../../../target/wasm32-unknown-unknown/$PROFILE/penumbra_wasm.wasm"
fi
if [ ! -f "$WASM_FILE" ]; then
    echo "Error: WASM file not found for profile $PROFILE" >&2
    exit 1
fi
echo "Found WASM file: $WASM_FILE ($(wc -c < "$WASM_FILE") bytes)"

# Step 2: wasm-bindgen (CLI version must equal the wasm-bindgen crate in Cargo.lock)
echo "Step 2: wasm-bindgen..."
# Start from an empty directory: wasm-bindgen never deletes files, and a
# leftover from an older build would be published with the package.
rm -rf "${OUT_DIR:?}"
mkdir -p "$OUT_DIR"
"$WASM_BINDGEN" "$WASM_FILE" --out-dir "$OUT_DIR" --out-name index --target web

# Step 2b: wasm-bindgen-rayon's worker helper registers a `message` listener on
# `self` in EVERY context that imports the module, and on a matching message
# hands the message's `receiver` (a pointer into wasm memory) to
# wbg_rayon_start_worker without checking the sender. Only rayon's own worker
# threads need it, and they are always dedicated workers; in a page any window
# that can postMessage to it could pass an arbitrary pointer. Register it only
# in a dedicated worker. (Also keeps Node, which has no `self`, working.)
HELPER=$(ls "$OUT_DIR"/snippets/wasm-bindgen-rayon-*/src/workerHelpers.js)
node - "$HELPER" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const from = "waitForMsgType(self, 'wasm_bindgen_worker_init').then(";
const to =
  '// penumbra: only rayon worker threads (dedicated workers) accept the init message.\n' +
  "(typeof DedicatedWorkerGlobalScope === 'function' && self instanceof DedicatedWorkerGlobalScope\n" +
  "  ? waitForMsgType(self, 'wasm_bindgen_worker_init')\n" +
  '  : new Promise(() => {})\n' +
  ').then(';
if (src.split(from).length !== 2) {
  console.error('workerHelpers.js: expected exactly one init listener; wasm-bindgen-rayon changed, re-check the patch');
  process.exit(1);
}
fs.writeFileSync(file, src.replace(from, to));
NODE

# Step 3: wasm-opt. Feature flags must cover everything rustc emitted, or
# wasm-opt fails validation (threads/atomics+shared memory, simd128, etc.).
if [ "${SKIP_WASM_OPT:-0}" != "1" ]; then
    echo "Step 3: wasm-opt $WASM_OPT_LEVEL..."
    "$WASM_OPT" "$WASM_OPT_LEVEL" \
        --enable-threads \
        --enable-bulk-memory \
        --enable-simd \
        --enable-mutable-globals \
        --enable-nontrapping-float-to-int \
        --enable-sign-ext \
        --enable-reference-types \
        --enable-multivalue \
        "$OUT_DIR/index_bg.wasm" \
        -o "$OUT_DIR/index_bg.wasm"
else
    echo "Step 3: SKIPPED (SKIP_WASM_OPT=1)"
fi

# The build output is committed (CI does not have this toolchain). The empty
# .npmignore keeps npm from ever applying a .gitignore to it.
touch "$OUT_DIR/.npmignore"

echo
echo "WASM build complete:"
wc -c "$OUT_DIR/index_bg.wasm" | awk '{printf "  index_bg.wasm: %s bytes (%.2f MB)\n", $1, $1/1024/1024}'
echo
echo "Verify before shipping: the memory import must be shared, e.g."
echo "  wasm-dis $OUT_DIR/index_bg.wasm | grep -m1 'import \"wbg\" \"memory\"'   # -> (memory ... shared)"

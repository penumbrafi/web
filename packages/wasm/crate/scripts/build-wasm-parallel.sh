#!/bin/bash
# Build multi-threaded WASM with rayon parallelism
#
# This script builds WASM with SharedArrayBuffer support using cargo directly,
# then runs wasm-bindgen to generate JavaScript bindings.
#
# Requirements:
#   - rust-src for the pinned toolchain (or TOOLCHAIN=nightly-YYYY-MM-DD)
#   - wasm-bindgen-cli matching Cargo.lock: cargo install wasm-bindgen-cli --version <lock version>
#   - wasm-opt (binaryen, REQUIRED)
#
# Browser requirements:
#   - SharedArrayBuffer + Atomics support
#   - Server headers:
#     Cross-Origin-Opener-Policy: same-origin
#     Cross-Origin-Embedder-Policy: require-corp

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(dirname "$SCRIPT_DIR")"
# Output to wasm-parallel/ to match package.json exports ("./wasm-parallel").
# (Previously defaulted to wasm/, which silently clobbered the serial build.)
OUT_DIR="${OUT_DIR:-${CRATE_DIR}/../wasm-parallel}"
# Cargo profile: speed-optimized (opt-level=3, fat LTO, 1 CGU); see Cargo.toml.
PROFILE="${PROFILE:-release-parallel}"
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
    --features parallel \
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
mkdir -p "$OUT_DIR"
"$WASM_BINDGEN" "$WASM_FILE" --out-dir "$OUT_DIR" --out-name index --target web

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

echo
echo "Multi-threaded WASM build complete:"
wc -c "$OUT_DIR/index_bg.wasm" | awk '{printf "  index_bg.wasm: %s bytes (%.2f MB)\n", $1, $1/1024/1024}'
echo
echo "Verify before shipping: the memory import must be shared, e.g."
echo "  wasm-dis $OUT_DIR/index_bg.wasm | grep -m1 'import \"wbg\" \"memory\"'   # -> (memory ... shared)"

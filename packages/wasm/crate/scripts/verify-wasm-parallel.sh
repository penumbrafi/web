#!/bin/bash
# Release gate for the parallel (rayon) wasm build. Fails unless wasm-parallel/:
#   - has every file the package exports / needs at runtime,
#   - imports a SHARED memory (threads need SharedArrayBuffer),
#   - exports initThreadPool (wasm-bindgen-rayon),
#   - has a .npmignore, without which npm-packlist applies wasm-parallel/.gitignore ("*")
#     and silently ships a tarball WITHOUT the parallel build.
#
# Needs wasm-dis (binaryen) on PATH or WASM_DIS=/path/to/wasm-dis.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$SCRIPT_DIR/../../wasm-parallel}"
WASM_DIS="${WASM_DIS:-wasm-dis}"
WASM="$DIR/index_bg.wasm"

fail() { echo "verify-wasm-parallel: $*" >&2; exit 1; }

for f in index.js index.d.ts index_bg.wasm .npmignore; do
  [ -e "$DIR/$f" ] || fail "missing $DIR/$f"
done
ls "$DIR"/snippets/wasm-bindgen-rayon-*/src/workerHelpers.js >/dev/null 2>&1 \
  || fail "missing wasm-bindgen-rayon workerHelpers.js snippet"

# (no pipe: grep -m1 closing early would SIGPIPE wasm-dis and trip pipefail)
grep -m1 -qE '\(import "wbg" "memory" \(memory .* shared\)' <("$WASM_DIS" "$WASM") \
  || fail "memory import is not shared (built without +atomics?)"

node -e '
const fs = require("fs");
const names = WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(process.argv[1]))).map(e => e.name);
if (!names.includes("initThreadPool")) { console.error("verify-wasm-parallel: no initThreadPool export"); process.exit(1); }
' "$WASM"

echo "verify-wasm-parallel: OK ($(wc -c < "$WASM") bytes, shared memory, initThreadPool)"

#!/bin/bash
# Release gate for the wasm build. Fails unless wasm/:
#   - has every file the package needs at runtime, and nothing else,
#   - imports a SHARED memory (threads need SharedArrayBuffer),
#   - exports initThreadPool (wasm-bindgen-rayon),
#   - has the dedicated-worker guard on wasm-bindgen-rayon's init listener,
#   - has a .npmignore, without which npm-packlist applies wasm/.gitignore ("*")
#     and silently ships a tarball WITHOUT the wasm.
#
# Needs wasm-dis (binaryen) on PATH or WASM_DIS=/path/to/wasm-dis.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$SCRIPT_DIR/../../wasm}"
WASM_DIS="${WASM_DIS:-wasm-dis}"
WASM="$DIR/index_bg.wasm"

fail() { echo "verify-wasm: $*" >&2; exit 1; }

command -v "$WASM_DIS" >/dev/null || fail "wasm-dis not found (binaryen): install it or set WASM_DIS"

for f in index.js index.d.ts index_bg.wasm .npmignore; do
  [ -e "$DIR/$f" ] || fail "missing $DIR/$f"
done
ls "$DIR"/snippets/wasm-bindgen-rayon-*/src/workerHelpers.js >/dev/null 2>&1 \
  || fail "missing wasm-bindgen-rayon workerHelpers.js snippet"

grep -q "penumbra: only rayon worker threads" "$DIR"/snippets/wasm-bindgen-rayon-*/src/workerHelpers.js \
  || fail "workerHelpers.js is missing the dedicated-worker guard (build with build-wasm.sh)"

# Only wasm-bindgen's own output: anything else would ship in the package.
stray=$(cd "$DIR" && find . -type f ! -name '.gitignore' ! -name '.npmignore' \
  ! -name 'index.js' ! -name 'index.d.ts' ! -name 'index_bg.wasm' ! -name 'index_bg.wasm.d.ts' \
  ! -path './snippets/*')
[ -z "$stray" ] || fail "unexpected files in $DIR: $stray"

# (no pipe: grep -m1 closing early would SIGPIPE wasm-dis and trip pipefail)
grep -m1 -qE '\(import "wbg" "memory" \(memory .* shared\)' <("$WASM_DIS" "$WASM") \
  || fail "memory import is not shared (built without +atomics?)"

node -e '
const fs = require("fs");
const names = WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(process.argv[1]))).map(e => e.name);
if (!names.includes("initThreadPool")) { console.error("verify-wasm: no initThreadPool export"); process.exit(1); }
' "$WASM"

echo "verify-wasm: OK ($(wc -c < "$WASM") bytes, shared memory, initThreadPool)"

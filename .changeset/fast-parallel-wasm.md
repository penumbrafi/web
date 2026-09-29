---
'@penumbrafi/wasm': minor
---

Parallel (rayon) wasm build: speed-optimized `release-parallel` cargo profile (opt-level=3, fat LTO, codegen-units=1), mandatory `wasm-opt -O3` with thread/SIMD features and a reproducible pinned toolchain. Proving-key load ~2.4x faster in measurement.

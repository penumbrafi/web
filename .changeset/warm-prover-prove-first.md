---
'@penumbra-zone/services': minor
'@penumbra-zone/types': minor
'@rotko/penumbra-wasm': minor
---

Keep the offscreen prover warm (close after 4 min idle, refcounted, consults the document's in-flight status) and prove before approval: new `build_actions_native` wasm export + `PROVE_PARALLEL` offscreen message; auth data is applied via `buildParallel` only after approval. Adds debug-level timing logs.

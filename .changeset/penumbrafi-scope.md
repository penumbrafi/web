---
'@penumbrafi/wasm': major
'@penumbrafi/types': major
'@penumbrafi/services': major
---

Publish under the `@penumbrafi` npm scope from penumbrafi/web CI, with npm provenance.

- `@rotko/penumbra-wasm` → `@penumbrafi/wasm` (continues the 55.x line: first release 56.0.0)
- `@rotko/penumbra-types` → `@penumbrafi/types` (continues 37.x: first release 38.0.0)
- `@rotko/penumbra-services` → `@penumbrafi/services` (continues 70.x: first release 71.0.0)

Breaking for consumers only in the import specifier: replace `@rotko/penumbra-*` (and, for services/wasm
internals, `@penumbra-zone/types`) with `@penumbrafi/*`. `services` and `wasm` now import `@penumbrafi/types`
instead of upstream `@penumbra-zone/types`. Peer dependencies on upstream `@penumbra-zone/*` packages are
`>=` ranges instead of the leaked `workspace:*` specifiers in `@rotko/penumbra-wasm@55.0.2`.
`wasm-parallel/` (rayon build) is now always shipped.

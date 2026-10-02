# @penumbra-zone/wasm

## 57.0.0

### Major Changes

- One threaded wasm build, nothing else.

  - `@penumbrafi/wasm` ships a single module built with atomics and shared memory. It loads itself once per context on import and needs `SharedArrayBuffer`, i.e. a cross-origin-isolated context (COOP `same-origin` + COEP `require-corp`) or Node; without it the import fails instead of degrading.
  - Removed: the serial build, the `./wasm-parallel` export, `initWasmWithParallel`, `isParallelSupported`, `ensureWasmReady`. Renamed: `buildWithRayon` → `buildTransaction`, `buildActionsWithRayon` → `proveActions`, `buildParallel` → `assembleTransaction`, `buildActionParallel` → `buildAction`.
  - `startThreads(n)` (from `@penumbrafi/wasm/init`) starts the thread pool and only runs in a dedicated worker. `authorizePlan` refuses to run in a context that started one.
  - wasm-bindgen-rayon's worker message listener is registered only in dedicated workers; it used to accept a memory pointer from any message in any context.
  - Proving: R1CS matrices cached per circuit and the five proof MSMs run concurrently (vendored ark-groth16 0.4.0); proofs are byte-identical.
  - Field arithmetic on wasm32: 32-bit-limb Montgomery multiply, square and two-term sum of products (vendored ark-ff 0.4.2), constant time, same output limbs as stock. A send (1 spend + 2 outputs) proves about 40% faster.

## 56.0.0

### Major Changes

- 8920434: Publish under the `@penumbrafi` npm scope, from penumbrafi/web.

  - `@rotko/penumbra-wasm` → `@penumbrafi/wasm` (continues the 55.x line: first release 56.0.0)
  - `@rotko/penumbra-types` → `@penumbrafi/types` (continues 37.x: first release 38.0.0)
  - `@rotko/penumbra-services` → `@penumbrafi/services` (continues 70.x: first release 71.0.0)

  Breaking for consumers only in the import specifier: replace `@rotko/penumbra-*` (and, for services/wasm
  internals, `@penumbra-zone/types`) with `@penumbrafi/*`. `services` and `wasm` now import `@penumbrafi/types`
  instead of upstream `@penumbra-zone/types`. Peer dependencies on upstream `@penumbra-zone/*` packages are
  `>=` ranges instead of the leaked `workspace:*` specifiers in `@rotko/penumbra-wasm@55.0.2`.
  `wasm-parallel/` (rayon build) is now always shipped.

### Minor Changes

- d429c87: Parallel (rayon) wasm build: speed-optimized `release-parallel` cargo profile (opt-level=3, fat LTO, codegen-units=1), mandatory `wasm-opt -O3` with thread/SIMD features and a reproducible pinned toolchain. Proving-key load ~2.4x faster in measurement.
- 1f2d5d6: Keep the offscreen prover warm (close after 4 min idle, refcounted, consults the document's in-flight status) and prove before approval: new `build_actions_native` wasm export + `PROVE_PARALLEL` offscreen message; auth data is applied via `buildParallel` only after approval. Adds debug-level timing logs.

### Patch Changes

- Updated dependencies [8920434]
- Updated dependencies [1f2d5d6]
  - @penumbrafi/types@38.0.0

## 53.0.0

### Patch Changes

- Updated dependencies [4657582]
  - @penumbra-zone/types@36.0.0

## 52.0.0

### Major Changes

- f1e701a: storage and wasm support for encrypted LP metadata

### Patch Changes

- Updated dependencies [bdb700d]
- Updated dependencies [f1e701a]
  - @penumbra-zone/types@35.0.0
  - @penumbra-zone/protobuf@11.0.0
  - @penumbra-zone/bech32m@18.0.0

## 51.0.1

### Patch Changes

- 82d034e: fix publish workflow
- Updated dependencies [82d034e]
  - @penumbra-zone/bech32m@17.0.1
  - @penumbra-zone/protobuf@10.1.1
  - @penumbra-zone/types@34.2.1

## 51.0.0

### Major Changes

- 6de12ea: Make the view service request for mapping indices to addresses take the randomizer into account.

  The WASM package has a breaking change in that the `get_address_by_index` function now
  _requires_ you to pass a randomizer.
  This can be an empty slice, indicating a randomizer consistent of all 0s.
  Clients should upgrade by adding a `&[]` parameter, which will preserve their current behavior.

### Patch Changes

- 61270de: bump penumbra protocol deps to v2.0.0-alpha.11

## 50.0.0

### Patch Changes

- Updated dependencies [cee8150]
  - @penumbra-zone/types@34.2.0

## 49.0.0

### Patch Changes

- Updated dependencies [ec85373]
  - @penumbra-zone/types@34.1.0

## 48.0.0

### Minor Changes

- dc1eb8b: tct frontier support for freshly generated wallets
- f9cd9dd: chunk genesis syncing

### Patch Changes

- Updated dependencies [dc1eb8b]
- Updated dependencies [f9cd9dd]
  - @penumbra-zone/protobuf@10.1.0
  - @penumbra-zone/types@34.0.0
  - @penumbra-zone/bech32m@17.0.0

## 47.0.0

### Patch Changes

- Updated dependencies [085e855]
  - @penumbra-zone/types@33.1.0

## 46.0.0

### Minor Changes

- 93f1d05: proto and storage changes to support querying tournament votes

### Patch Changes

- Updated dependencies [93f1d05]
  - @penumbra-zone/protobuf@10.0.0
  - @penumbra-zone/types@33.0.0
  - @penumbra-zone/bech32m@16.0.0

## 45.1.0

### Minor Changes

- 43249b0: spends delegation notes in the wasm planner

## 45.0.2

## 45.0.1

### Patch Changes

- Updated dependencies [405b5b1]
  - @penumbra-zone/types@32.2.1

## 45.0.0

### Patch Changes

- Updated dependencies [ce4c43e]
  - @penumbra-zone/types@32.2.0

## 44.0.0

### Patch Changes

- Updated dependencies [b0e0eef]
- Updated dependencies [5c45f2c]
- Updated dependencies [85022e1]
- Updated dependencies [3c48120]
  - @penumbra-zone/types@32.1.0

## 43.1.0

### Minor Changes

- 62a7767: bump wasm deps to latest tagged release

## 43.0.0

### Minor Changes

- 15d768f: transaction summary support for transaction info rpc

### Patch Changes

- Updated dependencies [15d768f]
  - @penumbra-zone/protobuf@9.0.0
  - @penumbra-zone/types@32.0.0
  - @penumbra-zone/bech32m@15.0.0

## 42.0.0

### Patch Changes

- @penumbra-zone/types@31.0.0

## 41.0.0

### Minor Changes

- 49ae3ab: LQT integration in web packages

### Patch Changes

- Updated dependencies [49ae3ab]
  - @penumbra-zone/protobuf@8.0.0
  - @penumbra-zone/types@30.0.0
  - @penumbra-zone/bech32m@14.0.0

## 40.0.0

### Patch Changes

- Updated dependencies [e51bc61]
  - @penumbra-zone/types@29.1.0

## 39.0.0

### Patch Changes

- Updated dependencies [68b8f36]
  - @penumbra-zone/protobuf@7.2.0
  - @penumbra-zone/bech32m@13.0.0
  - @penumbra-zone/types@29.0.0

## 38.0.0

### Patch Changes

- Updated dependencies [6869c52]
- Updated dependencies [29dd11a]
  - @penumbra-zone/types@28.0.0
  - @penumbra-zone/protobuf@7.1.0
  - @penumbra-zone/bech32m@12.0.0

## 37.1.0

### Minor Changes

- fd4f34a: bump deps to v0.81.3

## 37.0.0

### Patch Changes

- Updated dependencies [ebc58d2]
  - @penumbra-zone/types@27.1.0

## 36.0.0

### Minor Changes

- 95d5fd9: support transparent addresses for usdc noble IBC withdrawals

### Patch Changes

- Updated dependencies [95d5fd9]
  - @penumbra-zone/protobuf@7.0.0
  - @penumbra-zone/bech32m@11.0.0
  - @penumbra-zone/types@27.0.0

## 35.0.0

### Patch Changes

- Updated dependencies [d619836]
  - @penumbra-zone/types@26.4.0

## 34.0.0

### Patch Changes

- Updated dependencies [712e7b1]
  - @penumbra-zone/types@26.3.0

## 33.1.0

### Minor Changes

- ccbe3a5: migrate wasm unit test for witness to use mockDb

### Patch Changes

- Updated dependencies [838de8a]
  - @penumbra-zone/types@26.2.1

## 33.0.0

### Patch Changes

- Updated dependencies [291bc7d]
  - @penumbra-zone/types@26.2.0

## 32.1.0

### Minor Changes

- fa39e46: migrate wasm unit test for action building to use mockDb

## 32.0.0

### Patch Changes

- Updated dependencies [b5d2922]
  - @penumbra-zone/types@26.1.0

## 31.0.0

### Patch Changes

- Updated dependencies [3269282]
  - @penumbra-zone/protobuf@6.3.0
  - @penumbra-zone/bech32m@10.0.0
  - @penumbra-zone/types@26.0.0

## 30.1.0

### Minor Changes

- 48725e3: Added noble forwarding address wasm helpers

## 30.0.0

### Major Changes

- e0db143: API updates, renames, and test coverage

### Patch Changes

- Updated dependencies [e543db4]
  - @penumbra-zone/protobuf@6.2.0
  - @penumbra-zone/bech32m@9.0.0
  - @penumbra-zone/types@25.0.0

## 29.1.0

### Minor Changes

- 735e22b: add support for spend transaction planner requests in wasm

## 29.0.0

### Minor Changes

- b6e32f8: Add is_controlled_address() support

### Patch Changes

- Updated dependencies [b6e32f8]
- Updated dependencies [b6e32f8]
- Updated dependencies [b6e32f8]
  - @penumbra-zone/protobuf@6.1.0
  - @penumbra-zone/bech32m@8.0.0
  - @penumbra-zone/types@24.0.0

## 28.0.0

### Minor Changes

- 990291f: TCT block acceleration

### Patch Changes

- @penumbra-zone/types@23.0.0

## 27.0.0

### Major Changes

- e01d5f8: fresh and existing wallets skip trial decryption

### Patch Changes

- Updated dependencies [e01d5f8]
  - @penumbra-zone/types@22.0.0

## 26.2.0

### Minor Changes

- e7d0767: Customize symbol for LP position NFTs

## 26.1.0

### Minor Changes

- 598d148: better error message for insufficient note balance

## 26.0.0

### Patch Changes

- @penumbra-zone/types@21.0.0

## 25.0.0

### Patch Changes

- Updated dependencies [49263c6]
  - @penumbra-zone/protobuf@6.0.0
  - @penumbra-zone/bech32m@7.0.0
  - @penumbra-zone/types@20.0.0

## 24.0.0

### Minor Changes

- 10ef940: Updating to v0.80.0 bufbuild types

### Patch Changes

- Updated dependencies [10ef940]
  - @penumbra-zone/protobuf@5.7.0
  - @penumbra-zone/types@19.0.0

## 23.0.0

### Patch Changes

- Updated dependencies [bd43d49]
- Updated dependencies [807648a]
  - @penumbra-zone/types@18.2.0

## 22.1.0

### Minor Changes

- 534a6ad: Disable change max

## 22.0.0

### Patch Changes

- Updated dependencies [f5bea48]
  - @penumbra-zone/types@18.1.0

## 21.0.0

### Patch Changes

- Updated dependencies [a9ffd2d]
- Updated dependencies
  - @penumbra-zone/types@18.0.0
  - @penumbra-zone/protobuf@5.6.0

## 20.2.0

### Minor Changes

- 318690e: Properly derive DelegatorVoteView from perspective

## 20.1.0

### Minor Changes

- d6ce325: Support customizing symbol for vote receipt tokens

### Patch Changes

- 3477bef: bugfix: injecting globalThis.**DEV** correctly on prod builds
- Updated dependencies [3477bef]
  - @penumbra-zone/types@17.0.1

## 20.0.0

### Minor Changes

- 4e30796: Witness delegator vote plans

### Patch Changes

- @penumbra-zone/types@17.0.0

## 19.0.0

### Patch Changes

- Updated dependencies [0233722]
  - @penumbra-zone/types@16.1.0

## 18.0.0

### Patch Changes

- Updated dependencies [22bf02c]
  - @penumbra-zone/protobuf@5.5.0
  - @penumbra-zone/types@16.0.0

## 17.0.2

### Patch Changes

- Updated dependencies [3aaead1]
  - @penumbra-zone/types@15.1.1

## 17.0.1

### Patch Changes

- 1a57749: Bug fix with get_all_notes not respecting None asset id + delegator voting tests

## 17.0.0

### Minor Changes

- 83151cb: Use the generated metadata for delegation tokens
- 1011b3b: Add delegator voting support
- 5641af2: Internally use dependency injection for storage for easier testing

### Patch Changes

- cbc2419: Stop truncating metadata symbols programatically
- Updated dependencies [877fb1f]
  - @penumbra-zone/types@15.1.0

## 16.0.0

### Minor Changes

- fa798d9: Update deps to v0.79.0
- fa798d9: Bufbuild + registry dep update

### Patch Changes

- Updated dependencies [fa798d9]
  - @penumbra-zone/protobuf@5.4.0
  - @penumbra-zone/types@15.0.0

## 15.0.0

### Minor Changes

- 28a48d7: Send max support

### Patch Changes

- Updated dependencies [28a48d7]
  - @penumbra-zone/types@14.0.0

## 14.0.0

### Minor Changes

- 43ccd96: Modify GasPrices storage to support multi-asset fees

### Patch Changes

- Updated dependencies [43ccd96]
  - @penumbra-zone/types@13.1.0

## 13.0.0

### Patch Changes

- 3708e2c: include peer deps as dev deps
- 2f1c39f: Alt token fee extraction refactor + tests
- Updated dependencies [e9e1320]
- Updated dependencies [3708e2c]
  - @penumbra-zone/protobuf@5.3.1
  - @penumbra-zone/bech32m@6.1.1
  - @penumbra-zone/types@13.0.0

## 12.0.0

### Minor Changes

- Synchronize published @buf deps

### Patch Changes

- Updated dependencies
  - @penumbra-zone/protobuf@5.3.0
  - @penumbra-zone/types@12.0.0

## 11.0.0

### Patch Changes

- Updated dependencies
  - @penumbra-zone/types@11.0.0

## 10.0.0

### Minor Changes

- 4161587: Update to latest bufbuild deps (v0.77.4)
- e207faa: finalize ceremony proving keys and update crate deps (v0.78.0)

### Patch Changes

- Updated dependencies [4161587]
  - @penumbra-zone/protobuf@5.2.0
  - @penumbra-zone/types@10.0.0

## 9.0.0

### Minor Changes

- 9b3f561: properly build esm relative paths

### Patch Changes

- Updated dependencies [9b3f561]
  - @penumbra-zone/protobuf@5.1.0
  - @penumbra-zone/bech32m@6.1.0
  - @penumbra-zone/types@9.0.0

## 8.0.0

### Major Changes

- f067fab: reconfigure all package builds

### Patch Changes

- Updated dependencies [f067fab]
  - @penumbra-zone/protobuf@5.0.0
  - @penumbra-zone/bech32m@6.0.0
  - @penumbra-zone/types@8.0.0

## 7.1.1

### Patch Changes

- Updated dependencies [a75256f]
  - @penumbra-zone/protobuf@4.2.0
  - @penumbra-zone/types@7.1.1

## 7.1.0

### Minor Changes

- 81b9536: add ibc types to registry, address wasm ser/de of protobuf.Any types

### Patch Changes

- 14ba562: Update transaction_perspective_and_view return type
- Updated dependencies [ab9d743]
- Updated dependencies [282eabf]
- Updated dependencies [81b9536]
- Updated dependencies [c8e8d15]
  - @penumbra-zone/types@7.1.0
  - @penumbra-zone/protobuf@4.1.0

## 7.0.0

### Major Changes

- 8fe4de6: correct ordering of default export

### Patch Changes

- @penumbra-zone/types@7.0.1

## 6.0.0

### Major Changes

- 8b121ec: change package exports to use 'default' field

### Patch Changes

- Updated dependencies [bb5f621]
  - @penumbra-zone/types@7.0.0

## 5.1.0

### Minor Changes

- 3ea1e6c: update buf types dependencies

### Patch Changes

- e86448e: include transaction id when generating perspective
- Updated dependencies [029eebb]
- Updated dependencies [3ea1e6c]
  - @penumbra-zone/types@6.0.0

## 5.0.1

## 5.0.0

### Major Changes

- 65677c1: publish javascript instead of typescript

### Minor Changes

- e4c9fce: Add features to handle auction withdrawals

### Patch Changes

- 8ccaf30: readme update recommending bsr
- e35c6f7: Deps bumped to latest
- 99feb9d: add base denom string to binary AssetId conversion utility
- Updated dependencies [146b48d]
- Updated dependencies [e35c6f7]
- Updated dependencies [8ccaf30]
  - @penumbra-zone/types@5.0.0

## 4.0.4

### Patch Changes

- v8.0.0 versioning and manifest
- Updated dependencies
  - @penumbra-zone/types@4.1.0

## 4.0.3

### Patch Changes

- @penumbra-zone/types@4.0.1

## 4.0.2

### Patch Changes

- Updated dependencies [6fb898a]
  - @penumbra-zone/types@4.0.0

## 4.0.1

### Patch Changes

- Updated dependencies [3148375]
  - @penumbra-zone/types@3.0.0

## 4.0.0

### Major Changes

- 78ab976: configure for publish

### Patch Changes

- @penumbra-zone/types@2.0.1

## 3.0.0

### Major Changes

- 66c2407: v6.2.0 release

## 2.0.0

### Major Changes

- 929d278: barrel imports to facilitate better tree shaking

### Minor Changes

- 8933117: Account for changes to core

### Patch Changes

- Updated dependencies [929d278]
  - @penumbra-zone/types@2.0.0

## 1.0.2

### Patch Changes

- Updated dependencies
  - @penumbra-zone/types@1.1.0

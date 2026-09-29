# Release plan: zafu's wasm/JS packages from one monorepo

Status: proposal (2026-09-29). Nothing here has been done yet except the
parallel-build changes on `perf/wasm-build-profile`.

## Where things are today

| zafu consumes                        | source today                                             | how it ships                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@rotko/penumbra-wasm@55.0.2`        | this repo, branch `fix/wasm-compile-bundler` (not main)  | published by hand. The npm `gitHead` is `49ee2589`, not a tagged main commit. CI never builds `wasm-parallel/` because the flake has no nightly or binaryen and `just build-packages` does not run `compile:parallel` |
| `@rotko/penumbra-types@37.0.0`       | separate repo `rotkonetworks/penumbra-types`             | published by hand. This repo still calls it `@penumbra-zone/types@36`                                                                                                  |
| `@rotko/penumbra-services@70.0.0`    | separate repo `rotkonetworks/penumbra-services`          | published by hand. This repo still calls it `@penumbra-zone/services@69`                                                                                               |
| `@repo/zcash-wasm` (private)         | `rotkonetworks/zcli` → `crates/zcash-wasm` (crate `zafu-wasm`) | vendored `.wasm`/glue blobs committed into zafu twice (`packages/zcash-wasm/` + `apps/extension/public/zafu-wasm/`), with a hand-applied Chrome `workerHelpers.js` patch. Provenance is tracked by hand in `BUILD_PROVENANCE.md` |

Zcash proving (orchard / halo2, rayon) lives entirely in that zcli blob.
zafu has no npm dependency on orchard or halo2.

## Target layout (this repo, `rotkonetworks/penumbra-web` main)

- `packages/wasm` → **`@rotko/penumbra-wasm`**. Ships both builds: serial `wasm/` (bundler) and
  parallel `wasm-parallel/` (web, rayon).
- `packages/types` → **`@rotko/penumbra-types`**. Fold in the delta from the
  `penumbra-types` repo, then archive that repo.
- `packages/services` → **`@rotko/penumbra-services`**. Same approach as types.
- NEW `packages/zcash-wasm` → **`@rotko/zcash-wasm`**. It stays a separate package and has
  no dependency on any penumbra package. It contains only the JS wrapper, the build script and
  `ZCLI_REV`. The Rust source stays in zcli, because `zafu-wasm` path-depends on `frost-spend`,
  `zcash-voting`, `zoda-vss` and `pir-client`, and uses zcli's `.cargo/config.toml` link-args,
  which must NOT be overridden by `RUSTFLAGS`. Its build checks out zcli at the rev in
  `ZCLI_REV` and runs `cargo wasm-parallel` / `wasm-single`, `wasm-bindgen`, `wasm-opt`. It then
  applies the `workerHelpers.js` Chrome patch as a scripted, asserted step (it currently has to
  be re-applied by hand), verifies the shared imported memory, and writes sha256s into the
  package's `PROVENANCE.json`.

Penumbra and Zcash stay separate packages with separate Cargo locks and
toolchains. Penumbra pins 1.83 plus `RUSTC_BOOTSTRAP` for build-std and wasm-bindgen 0.2.106.
zcli uses nightly and wasm-bindgen 0.2.126. Don't unify them: each wasm-bindgen CLI has to match
its own lock.

## Build / release pipeline

- **changesets** (already configured in `.changeset/`, `access: public`), with
  `packages-release.yml` → `changesets/action`. That opens a "version packages" PR and
  publishes on merge.
- Make the parallel build work under `nix develop`. It fails there today, which is why 55.0.2
  was published by hand. Three changes are needed:
  - add `rust-src` to `components` in `crate/rust-toolchain.toml`. rust-overlay reads that
    file (flake.nix:22), and the build script uses the pinned 1.83 with `RUSTC_BOOTSTRAP=1`
    for `-Z build-std`.
  - add `binaryen` to the devShell.
  - add a `wasm-bindgen-cli` that matches Cargo.lock (0.2.106). The nixpkgs version won't
    match, so it needs an override or a pinned `cargo install` in CI.

  The serial build does not have this problem because wasm-pack fetches a matching bindgen CLI
  itself. After that, make `compile:parallel` part of the turbo `compile` pipeline, so npm
  tarballs are always built in CI and never locally.
- The release job runs `pnpm compile:all`. It then asserts that the parallel blob has
  `(memory … shared)` and exports `initThreadPool`, and prints the sizes. Only after that
  does it run `changeset publish`, with npm provenance (`--provenance`).

## Versioning

- Keep each package's current semver line and bump from there:
  penumbra-wasm 55.x (this branch → 55.1.0, minor), types above 37, services above 70.
  zcash-wasm starts at 0.2.0 to match the crate version.
- Internal dependencies use `workspace:*`. changesets rewrites them to exact versions
  on publish (`updateInternalDependencies: patch`).
- zcash-wasm versions independently (not in a `fixed` group). The zcli rev goes in the
  changeset text.

## zafu migration

1. Publish from CI once. Then in zafu, pin the new exact versions of
   `@rotko/penumbra-{wasm,types,services}` (no change beyond the version).
2. Replace `@repo/zcash-wasm` with `@rotko/zcash-wasm`. Change the webpack copy step to
   copy `node_modules/@rotko/zcash-wasm/*` into `public/zafu-wasm/` at build time, instead
   of the committed blobs. Then delete both vendored trees and `BUILD_PROVENANCE.md` (its
   content moves to the package).
3. Merge `perf/dedupe-proving-key-fetch` in zafu (the proving-key fetch dedupe). It is
   independent of the version bump.
4. Gate: `pnpm build`, the extension tests, one Penumbra send plus one delegator vote
   (parallel path), and one Zcash ironwood send, all in a loaded extension. Only then
   release zafu.

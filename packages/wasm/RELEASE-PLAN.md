# Release plan: zafu's wasm/JS packages

Status (2026-09-30): the `@penumbrafi` rename, the CI release workflow and the zafu migration
are prepared on local branches. Nothing has been published, pushed or deprecated yet.

- penumbra-web `release/penumbrafi-scope`, based on `beta/prover-20260929`
- zafu `release/penumbrafi-deps`, based on `beta/prover-20260929`

## Naming

| was (npm, published by hand from 3 repos) | now (npm, published from `penumbrafi/web` CI) | source                   | first version |
| ----------------------------------------- | --------------------------------------------- | ------------------------ | ------------- |
| `@rotko/penumbra-wasm@55.0.2`             | **`@penumbrafi/wasm`**                        | `packages/wasm`          | 56.0.0        |
| `@rotko/penumbra-types@37.0.0`            | **`@penumbrafi/types`**                       | `packages/types`         | 38.0.0        |
| `@rotko/penumbra-services@70.0.0`         | **`@penumbrafi/services`**                    | `packages/services`      | 71.0.0        |
| `@repo/zcash-wasm` (vendored in zafu)     | `@rotko/zcash-wasm`: **not** under penumbrafi | zcli `crates/zcash-wasm` | 0.2.0         |

Versions carry on from each `@rotko/*` line so the numbers keep meaning something. Each gets a
major bump, because the import specifier changes. The base versions were reset to the npm
lines (types 36→37, services 69→70) and `.changeset/penumbrafi-scope.md` bumps all three
`major`. A local `changeset version` dry run gave exactly 56.0.0 / 38.0.0 / 71.0.0.

Zcash stays separate. It does not depend on any penumbra package and is not published under the
penumbrafi scope. Penumbra pins Rust 1.83 + `RUSTC_BOOTSTRAP` and wasm-bindgen 0.2.106. zcli
uses nightly and wasm-bindgen 0.2.126. Don't unify them. The `@rotko/zcash-wasm` package plan
is unchanged from the previous version of this file: a wrapper package that builds zcli at a
pinned `ZCLI_REV`, applies the Chrome `workerHelpers.js` patch as a scripted step and writes
`PROVENANCE.json`.

## What changed in this repo

- Package names are now `@penumbrafi/{wasm,types,services}`. Every workspace import was rewritten,
  including `@penumbra-zone/types` → `@penumbrafi/types` across apps and packages. This means
  `services` and `wasm` now import the fork's types instead of upstream's. zafu already
  aliased `@penumbra-zone/types` to the fork in webpack, so its runtime behaviour doesn't change.
- `repository` has `url: git+https://github.com/penumbrafi/web.git` and a `directory` per
  package. npm provenance rejects a package whose repository doesn't match the repo that built it.
- `publishConfig: { access: public, provenance: true }`.
- Peers on upstream `@penumbra-zone/*` packages are `>=` ranges, the same ones the beta tarballs
  used. Peers between the three packages are `workspace:^`, which is published as `^<version>`.
  `@rotko/penumbra-wasm@55.0.2` was published with raw `npm publish` and shipped literal
  `workspace:*` peers. That can't happen again, because publishing goes through `pnpm publish`.
- `@penumbra-zone/keys` moved from `optionalDependencies` to `devDependencies` of `wasm`. Nothing
  in `src` imports it, and consumers install the ~100MB keys themselves.
- `wasm-parallel/` gets a `.npmignore`, written at the end of `build-wasm-parallel.sh`. Without it,
  npm-packlist applies `wasm-parallel/.gitignore` (`*`) and **the tarball silently ships without
  the parallel build**. This was checked with `npm pack --dry-run`: 0 wasm-parallel files before
  the fix, 5 after.
- `crate/scripts/verify-wasm-parallel.sh` is a release gate. It checks the required files and
  the `.npmignore`, that the memory import is `shared`, and that `initThreadPool` is exported.
- `.changeset/config.json` sets `onlyUpdatePeerDependentsWhenOutOfRange`. Without it, the major
  bump on `types` also bumps crypto-web and storage (unpublished here) to majors, and rewrites the
  services peers to `>=49` / `>=63`, versions that don't exist on npm.
- `.syncpackrc`: the `>=` peer ranges of `@penumbrafi/**` are exempt from the workspace-protocol
  rule, and the ban on depending on BSR packages covers `@penumbrafi/**`.
- `scripts/publish-penumbrafi.sh` publishes **only** the three `@penumbrafi/*` packages, in
  order types → wasm → services. It uses `pnpm publish` (npm does the provenance signing) and
  skips any version that is already on npm. `changeset publish` is not used, because it would
  also try to publish every public `@penumbra-zone/*` workspace package.
- `.github/workflows/release.yml` is new. `packages-release.yml` is removed; main had already
  removed it.
  - job `version`: when a push to main has pending changesets, it opens or updates the
    "Version @penumbrafi packages" PR.
  - job `publish`: runs after that PR is merged and no changesets are left, and only if some
    version is not on npm yet. It installs Rust 1.83 with rust-src, wasm-pack 0.13.1,
    wasm-bindgen-cli 0.2.106 (checked against Cargo.lock) and binaryen 117 (sha256 pinned; the
    same wasm-opt the beta used). Then it runs `compile:parallel`, `turbo build` + `test` for
    `@penumbrafi/*`, the verify gate and `npm pack --dry-run`. Finally it publishes with OIDC
    provenance (`id-token: write`, `NPM_CONFIG_PROVENANCE`), and changesets/action creates the
    tags and GitHub releases.

## Operator steps (in order)

1. **npm**: the `penumbrafi` org already exists, owner `rotko`, and holds `@penumbrafi/registry`.
   Add maintainers with `npm org set penumbrafi <user> developer`. Create a **granular access
   token** with read+write on `@penumbrafi/*` (all packages in the scope; they don't exist
   yet) and "bypass 2FA".
2. **GitHub** `penumbrafi/web` → Settings → Secrets → Actions: add `NPM_TOKEN`. The workflow uses
   environment `npm`. GitHub creates it on first run; add required reviewers to it if a manual
   gate before publish is wanted.
3. Push `release/penumbrafi-scope` and open a PR into `main`. `main` is ~570 commits ahead of
   the beta base, so expect conflicts in lockfile, workflows and apps. Resolve them keeping the
   `@penumbrafi` names. The rename is mechanical: after the merge, re-run the sed over new files:
   `s#@penumbra-zone/(types|services)\b#@penumbrafi/\1#; s#@rotko/penumbra-wasm\b#@penumbrafi/wasm#`,
   but don't touch `@penumbra-zone/services-context`. Then run `pnpm install` and commit the lockfile.
4. Merge → CI opens "Version @penumbrafi packages" → merge that → CI publishes 56.0.0 / 38.0.0 /
   71.0.0 with provenance. Check with `npm view @penumbrafi/wasm@56.0.0 dist.attestations`.
5. Optional hardening: once the packages exist, configure npm **trusted publishing** for
   `penumbrafi/web` / `release.yml` on each package, then delete `NPM_TOKEN`.
6. Deprecate the old names (the operator runs this, logged in as `rotko`):

   ```sh
   npm deprecate @rotko/penumbra-wasm@"*"     "moved to @penumbrafi/wasm"
   npm deprecate @rotko/penumbra-types@"*"    "moved to @penumbrafi/types"
   npm deprecate @rotko/penumbra-services@"*" "moved to @penumbrafi/services"
   ```

7. zafu: on `release/penumbrafi-deps`, run `pnpm install` (this regenerates `pnpm-lock.yaml`,
   which still has the beta `file:` entries), commit, then gate: `pnpm build`, extension tests,
   one Penumbra send + one delegator vote (parallel path) and one Zcash send in a loaded extension.

## zafu migration diff (branch `release/penumbrafi-deps`)

Root `package.json`:

```diff
   "overrides": {
-    "@penumbra-zone/types": "file:../beta-pkgs/rotko-penumbra-types-37.1.0-beta.20260929.tgz",
-    "@penumbra-zone/wasm": "file:../beta-pkgs/rotko-penumbra-wasm-55.1.0-beta.20260929.tgz",
-    "@rotko/penumbra-wasm": "file:../beta-pkgs/rotko-penumbra-wasm-55.1.0-beta.20260929.tgz",
-    "@penumbra-zone/services": "file:../beta-pkgs/rotko-penumbra-services-70.1.0-beta.20260929.tgz"
+    "@penumbra-zone/types": "npm:@penumbrafi/types@38.0.0",
+    "@penumbra-zone/wasm": "npm:@penumbrafi/wasm@56.0.0",
+    "@penumbrafi/wasm": "56.0.0",
+    "@penumbra-zone/services": "npm:@penumbrafi/services@71.0.0"
   },
   "pnpm": {
     "overrides": {
       "@penumbra-labs/registry": "npm:@penumbrafi/registry@^13.0.0",
-      "@rotko/penumbra-services": "file:../beta-pkgs/rotko-penumbra-services-70.1.0-beta.20260929.tgz",
-      "@rotko/penumbra-types": "file:../beta-pkgs/rotko-penumbra-types-37.1.0-beta.20260929.tgz",
-      "@rotko/penumbra-wasm": "file:../beta-pkgs/rotko-penumbra-wasm-55.1.0-beta.20260929.tgz"
+      "@penumbrafi/services": "71.0.0",
+      "@penumbrafi/types": "38.0.0",
+      "@penumbrafi/wasm": "56.0.0"
     },
-    "peerDependencyRules": { "allowAny": ["@rotko/penumbra-wasm", "@penumbra-labs/registry"] }
+    "peerDependencyRules": { "allowAny": ["@penumbrafi/wasm", "@penumbra-labs/registry"] }
```

(The top-level npm-style `overrides` block is inert under pnpm and is updated only for consistency.)

- `.pnpmfile.cjs`: **no change**. It already copies every `pnpm.overrides` entry onto matching
  `peerDependencies`, so the `@penumbrafi/*` peers of services/wasm resolve to the pinned copy.
- `apps/extension`, `packages/{context,encryption,query,storage-chrome,ui,wallet}/package.json`:
  `@rotko/penumbra-*` (file: tarballs or old versions) → `@penumbrafi/*` at 56.0.0 / 38.0.0 /
  71.0.0. `packages/wallet` also gains `@penumbrafi/types` (a peer of `@penumbrafi/wasm`).
- Source imports and the webpack aliases: `@rotko/penumbra-*` → `@penumbrafi/*`.
- `.syncpackrc`: the beta file:-tarball ignore group is dropped.

Verified before anything was published, by pointing the overrides at `pnpm pack` tarballs of
this branch: tsc is clean for the extension, wallet, query, ui, context and storage-chrome; the
extension (647), wallet (72) and query (31) tests pass; `bundle:prod` builds and emits
`wasm-parallel/`.

## Known deltas vs the hand-published packages

- `@penumbrafi/types@38` = `@rotko/penumbra-types@37.0.0` plus the warm-prover
  `internal-msg/offscreen` additions. The only other dist difference is self-imports now using
  `@penumbrafi/types`.
- `@penumbrafi/services@71` **drops** three modules that `@rotko/penumbra-services@70.0.0` (built
  from the separate `rotkonetworks/penumbra-services` repo) exported: `note-reservation`, `tx-queue`
  and `ctx/parallel-build`. Neither zafu nor the rest of services imports them. The same was
  true of the beta tarball zafu has been running. If they are wanted back, port them from
  `feat/tx-queue` / the old repo first.
- Pre-existing on the beta base and not touched here: `@penumbra-zone/perspective` doesn't
  typecheck against the async wasm API (`get-address-view.ts`), so a full `turbo build` of all
  packages fails. The release workflow builds only `@penumbrafi/*` and their dependencies.
  `eslint --max-warnings 0` also reports 4 (wasm) and 3 (services) existing errors.

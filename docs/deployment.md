# Deployment Workflows

### NPM Packages

The packages in this repo are published using [changesets](https://github.com/changesets/changesets).

As changes are made in the repo, devs are encouraged to generate a changeset via `pnpm changeset`. These markdown files are committed along with their PR. They look like this:

```markdown
---
'@penumbra-zone/query': major
'@penumbra-zone/client': minor
---

A very helpful description of the changes
```

Only the `@penumbrafi/{types,wasm,services}` packages are published from this repo, by hand
by an npm maintainer: no GitHub workflow holds an npm key. The steps (versioning, the pinned wasm
toolchain, `scripts/publish-penumbrafi.sh`) are in
[packages/wasm/RELEASE-PLAN.md](../packages/wasm/RELEASE-PLAN.md#releasing).

### Node status page

Build the latest node status page in this repo via `pnpm build`. Take the resulting `dist` output,
zip the folder, and create a PR in [penumbra core](https://github.com/penumbra-zone/penumbra/tree/main/assets) updating `node-status.zip`.
When a new chain version is pushed, this will be deployed with it.

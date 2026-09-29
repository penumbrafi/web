#!/usr/bin/env bash
# Publish ONLY the @penumbrafi/* packages. Used as the changesets/action `publish` command
# instead of `changeset publish`, which would try to publish every public workspace package,
# including upstream @penumbra-zone/* ones this org does not own (403) and must not fork.
#
# - `pnpm publish` (not raw `npm publish`) so `workspace:` specifiers are rewritten to real
#   versions. @rotko/penumbra-wasm@55.0.2 was published with raw npm and leaked `workspace:*`
#   peer deps. pnpm hands the packed tarball to `npm publish`, which honours
#   publishConfig.provenance / NPM_CONFIG_PROVENANCE and signs via GitHub OIDC.
# - Idempotent: versions already on the registry are skipped, so re-runs and pushes to main
#   without a version bump are no-ops.
# - Prints "New tag: <name>@<version>" for each publish; changesets/action turns those lines
#   into git tags + GitHub releases.
#
# DRY_RUN=1 runs `pnpm publish --dry-run` and skips the registry lookup.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Git checks off via env, not --no-git-checks: newer npm CLIs reject that flag when pnpm
# forwards it. CI publishes from a clean main checkout; build outputs are gitignored.
export npm_config_git_checks=false

# Dependency order: types <- wasm <- services.
PKGS=(packages/types packages/wasm packages/services)

bash packages/wasm/crate/scripts/verify-wasm-parallel.sh

for dir in "${PKGS[@]}"; do
  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")
  case "$name" in
    @penumbrafi/*) ;;
    *) echo "refusing to publish $name (not @penumbrafi/*)" >&2; exit 1 ;;
  esac
  if [ "${DRY_RUN:-0}" = "1" ]; then
    (cd "$dir" && pnpm publish --dry-run --access public)
    continue
  fi
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip $name@$version (already published)"
    continue
  fi
  (cd "$dir" && pnpm publish --access public)
  echo "New tag: $name@$version"
done

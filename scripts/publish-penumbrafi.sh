#!/usr/bin/env bash
# Publish ONLY the @penumbrafi/* packages, by hand, from a maintainer's machine logged in to
# npm (`npm login`). Releases are never published from GitHub Actions: the npm key stays off
# CI. Used instead of `changeset publish`, which would try to publish every public workspace
# package, including upstream @penumbra-zone/* ones this org does not own (403) and must not
# fork. The full procedure is in packages/wasm/RELEASE-PLAN.md ("Releasing").
#
# - `pnpm publish` (not raw `npm publish`) so `workspace:` specifiers are rewritten to real
#   versions. @rotko/penumbra-wasm@55.0.2 was published with raw npm and leaked `workspace:*`
#   peer deps. No npm provenance: it can only be generated inside a CI runner.
# - Idempotent: versions already on the registry are skipped, so re-runs and pushes to main
#   without a version bump are no-ops.
# - Tags each published version locally (<name>@<version>); push the tags afterwards.
#
# DRY_RUN=1 runs `pnpm publish --dry-run` and skips the registry lookup.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Git checks off via env, not --no-git-checks: newer npm CLIs reject that flag when pnpm
# forwards it. The wasm build rewrites tracked build output, so the tree is not clean here;
# publish from an up-to-date main checkout.
export npm_config_git_checks=false

# Dependency order: types <- wasm <- services.
PKGS=(packages/types packages/wasm packages/services)

bash packages/wasm/crate/scripts/verify-wasm.sh

if [ "${DRY_RUN:-0}" != "1" ]; then
  who=$(npm whoami 2>/dev/null) || { echo "not logged in to npm: run \`npm login\` first" >&2; exit 1; }
  echo "publishing as npm user $who"
fi

published=()

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
  # npm asks for the 2FA one-time password itself, once per package.
  (cd "$dir" && pnpm publish --access public)
  git tag "$name@$version"
  published+=("$name@$version")
  echo "published + tagged $name@$version"
done

if [ "${#published[@]}" -gt 0 ]; then
  echo
  echo "Push the tags: git push origin ${published[*]}"
fi

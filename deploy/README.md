# Deploying the penumbrafi frontends

Everything in this directory is *documentation and host configuration*. The
build always happens in GitHub Actions from `main` or a tag — there are no
hand-built artifacts on the server and no magic binaries.

This README documents the deploy scheme end-to-end. Sections below are
labelled with their current status against production; see "What's already
applied / what remains" at the end before assuming any of this is live.

## What ships from this repo

| app | workflow | artifact | host path | served on |
| --- | --- | --- | --- | --- |
| veil | `.github/workflows/deploy-veil.yml` | `veil-<sha>.tar.zst` (Next.js standalone) | `/opt/penumbra-veil/{blue,green}` | `penumbra.fi`, alias `dex.rotko.net` |
| node-status | `.github/workflows/deploy-node-status.yml` | `node-status-<sha>.tar.zst` (Vite `dist/`) | `/opt/penumbra-node-status` | `status.penumbra.fi` (static, nginx) — **not yet deployed anywhere** |

`minifront` is **not** deployed from here. It lives on `app.antumbra.net` and
is out of scope; it is still built and linted by `turbo-ci.yml`.

`turbo-ci.yml` (plus `compile-wasm.yml`, which it calls) is the PR lint/test
workflow, moved off BuildJet runners onto `ubuntu-latest`.

veil's deploy model is blue/green — see that section below for the release
layout, the swap mechanism and the workflow behavior. There is no
single-instance fallback path in this repo; blue/green is the only model.

## Topology

Production runs on Proxmox containers behind an internal network. This repo
never names a specific internal IP address or embeds a host's SSH key — those
live in GitHub secrets (see below) so that cloning this public repo does not
hand out a map of the internal network. Container **numbers** and role names
are not secret and are used here as documentation:

* **Front-proxy container** — nginx, TLS termination, anycast entry point for
  `penumbra.fi` and `dex.rotko.net`. Holds `veil-upstream.conf` (blue/green
  routing, see below) and the `veil-swap` helper.
* **Node.js workload container** — runs the veil `blue`/`green` systemd units.
  This is also where node-status would run once deployed, and where the
  per-PR preview units run (see the previews section).

Wherever this README needs an address, port, or key it says
`<FRONT_PROXY_HOST>` / `<WORKLOAD_HOST>` / etc. and points at the secret that
actually holds the value on the day someone runs the one-time host setup.

## Transport

The workload container has sshd on an internal-only address, so Actions
reaches it with `ProxyJump` through a jump host:

```
runner --ssh--> deploy-jump@<jump host public IP> --(-W)--> web@<workload host internal IP>
```

The jump account should be forwarding-only: no shell, and `permitopen`
restricted to the workload container. `.github/actions/ssh-deploy` sets this
up and verifies the hop before anything is copied. The action takes the jump
host, target host and target user entirely as inputs (from secrets) — it has
no container numbers or IPs of its own.

**This forwarding-only jump account does not exist today.** The only working
path in is `ssh root@<proxmox host>` with full root, which is how deploys
happen by hand right now. Creating the scoped jump account is a prerequisite
for the workflow in this PR to actually run — see "what remains" below.

## Secrets and variables to create

Create two GitHub **Environments** in `penumbrafi/web` (Settings ->
Environments):

| environment | gates on | used by |
| --- | --- | --- |
| `production` | required reviewers (maintainers) | `deploy-veil.yml` (the swap step), `promote-veil.yml`, `deploy-node-status.yml` |
| `preview` | no required reviewers | `preview-veil.yml` |

`production` environment secrets:

| secret | value |
| --- | --- |
| `DEPLOY_SSH_KEY` | ed25519 **private** key for the deploy account, PEM body |
| `DEPLOY_HOST` | public address of the jump host |
| `DEPLOY_CT` | address of the workload container on the internal network |
| `DEPLOY_KNOWN_HOSTS` | pinned host keys for the jump host and the workload container — generate with `ssh-keyscan`, do not paste keys from this README into an issue or elsewhere public |

The same four are needed by `penumbra-explorer` and `penumbra-explorer-backend`
— as an org admin you can instead create them once as **organization** secrets
scoped to those repositories.

`preview` environment secrets are documented in the per-PR previews section
below.

Repository **variables** (Settings -> Secrets and variables -> Actions ->
Variables). These are inlined into the JS bundle at build time and are not
secret:

| variable | value |
| --- | --- |
| `NEXT_PUBLIC_GRAPHQL_HOST` | hostname only, no scheme — `api.explorer.penumbra.fi` (currently `api.explorer.rotko.net`) |
| `NEXT_PUBLIC_COMETBFT_WS_URL` | `wss://penumbra.rotko.net/websocket` |

Changing either one requires a rebuild, not just a host edit. Both have an
explicit fallback in the workflow, so leaving them unset keeps the current
rotko.net endpoints rather than baking an empty string into the bundle.

`PENUMBRA_INDEXER_CA_CERT` is empty on the host today, so no certificate has to
be carried into `shared/`; if it is ever set, put the file in `shared/` and
point the variable at that path.

`BASE_URL`, `PENUMBRA_GRPC_ENDPOINT`, `PENUMBRA_CHAIN_ID`,
`PENUMBRA_CUILOA_URL`, `PENUMBRA_INDEXER_ENDPOINT`,
`PENUMBRA_INDEXER_CA_CERT` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` are read at
**runtime** from the host files in `shared/`, so they are not needed in CI.
Set `BASE_URL=https://penumbra.fi` there when the domain goes live — it is what
canonical URLs and OpenGraph images are built from.

## node-status

`deploy-node-status.yml` builds and ships the Vite SPA the same way veil's
build job works, over the same `ssh-deploy` action, to
`/opt/penumbra-node-status` on the workload host. There is no systemd unit —
it's static files served by nginx on a dedicated port outside veil's
blue/green range (`3001`/`3002`), documented as a placeholder port in
`deploy/nginx-penumbra.fi.conf.example`.

**Status: not deployed anywhere.** No release tree, no nginx vhost, no
`status.penumbra.fi` entry exists on either container today. This workflow is
here so the path exists once someone stands up the host side; until then
`gh workflow run deploy-node-status.yml` will fail at the ssh step because the
target directory (and the deploy account itself) don't exist yet.

## One-time host setup

Generate the deploy key on a workstation (never on the server, never commit
it):

```sh
ssh-keygen -t ed25519 -C 'github-actions penumbrafi deploy' -f ~/.ssh/penumbrafi_deploy -N ''
```

Put the private key in `DEPLOY_SSH_KEY`. Then, as root on the jump host:

```sh
# forwarding-only jump account
adduser --system --shell /usr/sbin/nologin --home /var/lib/deploy-jump deploy-jump
install -d -m 700 -o deploy-jump -g nogroup /var/lib/deploy-jump/.ssh
cat > /var/lib/deploy-jump/.ssh/authorized_keys <<'KEY'
restrict,port-forwarding,permitopen="<WORKLOAD_HOST_INTERNAL_IP>:22" ssh-ed25519 AAAA...  github-actions penumbrafi deploy
KEY
chown deploy-jump:nogroup /var/lib/deploy-jump/.ssh/authorized_keys
chmod 600 /var/lib/deploy-jump/.ssh/authorized_keys
```

And inside the workload container:

```sh
# tools the deploy needs
apt-get update && apt-get install -y rsync zstd

# the deploy account is the existing `web` user that already owns /opt/*
install -d -m 700 -o web -g web /home/web/.ssh
cat > /home/web/.ssh/authorized_keys <<'KEY'
ssh-ed25519 AAAA...  github-actions penumbrafi deploy
KEY
chown web:web /home/web/.ssh/authorized_keys
chmod 600 /home/web/.ssh/authorized_keys

# release layout for node-status (veil's layout is in the blue/green section)
install -d -o web -g web /opt/penumbra-node-status/releases
```

The blue/green section below has the rest of the host setup for veil itself
(units, `veil-swap`, sudoers).

## Known unverified

* GitHub-hosted runners reaching the jump host on `:22` — not yet exercised
  from a runner IP.
* Whether veil's native dependency `canvas` loads on the host if built on
  `ubuntu-latest` (glibc 2.39) against a Debian bookworm target (glibc 2.36).
  If `server.js` fails on the first deploy with a `GLIBC_` or `.node` loader
  error, switch the build job to `container: node:22-bookworm`.

## What's already applied / what remains

Applied by hand, already live in production:

* Blue/green systemd units and the `veil-swap` helper — see the blue/green
  section.
* The front-proxy vhosts for `penumbra.fi` and `dex.rotko.net`, routed through
  `veil-upstream.conf`.

Not yet applied — required before `gh workflow run deploy-veil.yml` will work
end-to-end:

* The forwarding-only jump account described above (today only a full-root
  SSH path exists).
* The four `production` environment secrets and the `production` /
  `preview` GitHub Environments themselves.
* node-status host setup (release dir exists nowhere, no vhost).
* Everything under the per-PR previews section (dedicated user, wildcard
  vhost, wildcard cert, Cloudflare Access, sysctl reservation).
* Staging vhost for `staging.penumbra.fi` (DNS + certificate not issued yet;
  the include is documented, not enabled) — see the blue/green section.

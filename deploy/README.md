# Deploying the penumbrafi frontends

Everything in this directory is _documentation and host configuration_. The
build always happens in GitHub Actions from `main` or a tag — there are no
hand-built artifacts on the server and no magic binaries.

This README documents the deploy scheme end-to-end. Sections below are
labelled with their current status against production; see "What's already
applied / what remains" at the end before assuming any of this is live.

## What ships from this repo

| app             | workflow                                   | artifact                                      | host path                                                                | served on                                                                       |
| --------------- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| veil            | `.github/workflows/deploy-veil.yml`        | `veil-<sha>.tar.zst` (Next.js standalone)     | `/opt/penumbra-veil/{blue,green}`                                        | `penumbra.fi`, alias `dex.rotko.net`                                            |
| veil (dev slot) | `.github/workflows/deploy-dev.yml`         | `veil-dev-<sha>.tar.zst` (Next.js standalone) | `/opt/penumbra-veil/dev`                                                 | `dev.penumbra.fi` (Cloudflare Access) — **host side not yet set up**            |
| node-status     | `.github/workflows/deploy-node-status.yml` | `node-status-<sha>.tar.zst` (Vite `dist/`)    | `/opt/penumbra-node-status`                                              | `status.penumbra.fi` (static, nginx) — **not yet deployed anywhere**            |
| assets          | `.github/workflows/deploy-assets.yml`      | `assets-<sha>.tar.zst` (Next.js standalone)   | `/opt/penumbra-assets` (single slot, `penumbra-assets.service` on :3004) | `assets.penumbra.fi` (nginx basic auth) — host setup in `apps/assets/README.md` |

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

- **Front-proxy container (CT1102)** — nginx, TLS termination, anycast entry
  point for `penumbra.fi` and `dex.rotko.net`. Holds `veil-upstream.conf`
  (blue/green routing, see below), the `veil-swap` helper, and (once set up)
  the per-PR previews wildcard vhost + Cloudflare Access front door.
- **Node.js workload container (CT1199)** — runs the veil `blue`/`green`
  systemd units. This is also where node-status would run once deployed, and
  where the per-PR preview units run (see the previews section).

Wherever this README needs an address, port, or key it says
`<FRONT_PROXY_HOST>` / `<WORKLOAD_HOST>` / etc. and points at the secret that
actually holds the value on the day someone runs the one-time host setup.

## Transport

**Two containers, not one.** The workload container (runs the veil units) and
the front-proxy container (runs nginx and `veil-swap`) are different boxes on
the internal network. `.github/actions/ssh-deploy` sets up a jump host and
proxies to _either or both_, as `target` and `proxy` respectively — pass
whichever host inputs a given job needs:

```
runner --ssh--> deploy-jump@<jump host public IP> --(-W)--> web@<workload host internal IP>   (alias: target)
                                                  \-(-W)--> web@<front-proxy host internal IP> (alias: proxy)
```

`deploy-veil.yml` and `promote-veil.yml` need both: `target` to ship the
release and restart the standby unit, `proxy` to call `veil-swap` and to
smoke-test through nginx. `deploy-node-status.yml` only needs `target`.

The jump account should be forwarding-only: no shell, and `permitopen`
restricted to the two containers it's allowed to reach. The action verifies
each hop it was given inputs for before anything is copied. It has no
container numbers or IPs of its own — those come entirely from secrets.

**The forwarding-only jump account now exists.** It is a shell-less
(`/usr/sbin/nologin`, `ForceCommand /usr/sbin/nologin`, no sudo) account on
the Proxmox host, shared with `penumbrafi/penumbra-explorer` but keyed
separately: each repo has its own keypair, and each key carries its own
`permitopen` list, so the explorer key still reaches only the workload
container while the veil key reaches the workload _and_ front-proxy
containers. A `from=` restriction is not usable — GitHub-hosted runners have
no stable source addresses — so `permitopen` plus a matching `PermitOpen` in
the host's `Match User deploy-jump` block is the whole confinement:

```sh
# authorized_keys options are comma-separated, one permitopen per host
restrict,port-forwarding,permitopen="<WORKLOAD_HOST>:22",permitopen="<FRONT_PROXY_HOST>:22" ssh-ed25519 AAAA...

# sshd_config takes a SPACE-separated list, and the Match block must be the
# LAST thing in the file — `Include /etc/ssh/sshd_config.d/*.conf` sits at the
# top, so a Match in a drop-in would swallow every global keyword after it.
Match User deploy-jump
    AllowTcpForwarding local
    PermitOpen <WORKLOAD_HOST>:22 <FRONT_PROXY_HOST>:22
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    ForceCommand /usr/sbin/nologin
```

Verify with `sshd -t && sshd -T -C user=deploy-jump | grep -i permitopen`, and
prove the confinement by checking that a forward to any other host/port is
refused with `administratively prohibited`.

## Fullnode RPC vhost (the broadcast path)

`deploy/nginx-penumbra-rpc.conf.example` documents the vhost in front of the
Penumbra fullnode — CometBFT RPC and pd gRPC. This is what veil's server-side
`/api/penumbra/broadcast` route calls via `PENUMBRA_GRPC_ENDPOINT`.

**It must set `large_client_header_buffers 4 64k;`.** CometBFT's
`/broadcast_tx_sync` reads the transaction from the query string, so veil puts
the whole hex-encoded transaction in the request line. nginx's default
`4 8k` caps that line at 8192 bytes, and real broadcasts already reach ~7900 —
so larger transactions get a 414 from nginx and never reach the chain.

That failure is deceptive from the browser. The veil route turns the upstream
414 into a 502, and any fronting vhost with `proxy_intercept_errors on`
(the dev vhost has it) replaces that 502's JSON body with an error page, so the
console shows only a bare `HTTP 502` with no cause. If you see unexplained
broadcast 502s, check the fullnode vhost's access log for `414` first.

The example also shows a `location = /rpc` block proxying CometBFT's JSON-RPC
root, which removes the URI limit entirely — the migration path if transactions
keep growing.

## Secrets and variables to create

Create two GitHub **Environments** in `penumbrafi/web` (Settings ->
Environments):

| environment  | gates on                         | used by                                                                         |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------- |
| `production` | required reviewers (maintainers) | `deploy-veil.yml` (the swap step), `promote-veil.yml`, `deploy-node-status.yml` |
| `preview`    | no required reviewers            | `preview-veil.yml`                                                              |

`production` environment secrets:

| secret               | value                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | ed25519 **private** key for the deploy account, PEM body                                                                                                                                      |
| `DEPLOY_HOST`        | public address of the jump host                                                                                                                                                               |
| `DEPLOY_CT`          | address of the workload container on the internal network                                                                                                                                     |
| `DEPLOY_PROXY_CT`    | address of the front-proxy container on the internal network                                                                                                                                  |
| `DEPLOY_KNOWN_HOSTS` | pinned host keys for the jump host, the workload container, and the front-proxy container — generate with `ssh-keyscan`, do not paste keys from this README into an issue or elsewhere public |

`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_CT` and `DEPLOY_KNOWN_HOSTS` are also
needed by `penumbra-explorer` and `penumbra-explorer-backend` (they don't talk
to the front-proxy container, so they don't need `DEPLOY_PROXY_CT`) — as an
org admin you can instead create those four once as **organization** secrets
scoped to those repositories.

`preview` environment secrets are documented in the per-PR previews section
below.

Repository **secrets** (not environment-scoped):

| secret                               | value                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `openssl rand -base64 32`, identical to the value in every colour's `.env.production.local` on the host |

This one is deliberately repository-scoped rather than `production`-scoped.
Next.js encrypts Server Action closures with it at **build** time and decrypts
them with it at **runtime**; veil has ~15 `'use server'` modules, so a mismatch
means every action 500s on the deployed bundle. The consumer is therefore the
`build` job — and only the `deploy` job carries `environment: production`.
Scoping the key to `production` would leave `build` expanding it to `""`,
whereupon Next silently generates a fresh per-build key that no host copy can
ever match; giving `build` the `production` environment instead would hand
deployment credentials to a job that has no use for them. Rotating it means
writing the new value to the repository secret **and** to both colours'
`.env.production.local` in the same pass.

### Branch protection and tag rulesets (required)

The deploy workflows pin their checkouts to `refs/heads/main` so a tag
push or a `workflow_dispatch` from any branch cannot ship a version of
`.github/actions/ssh-deploy` written by an attacker. That pin is only
meaningful when combined with:

1. **Branch protection on `main`** — Settings -> Branches -> Add rule:
   require pull request review before merge, require the `Turbo CI`
   status check to pass, and _disable_ force pushes. Otherwise anyone
   who can push to main can rewrite `main` to include a poisoned
   ssh-deploy action and immediately ship it.
2. **Repository ruleset restricting `v*` tag pushes** — Settings ->
   Rules -> New ruleset -> "Restrict creations" and "Restrict updates"
   on `refs/tags/v*`, allowed actors: maintainers only. This is the
   companion to the deploy-veil.yml pin: without it, any collaborator
   could push `v9.9.9` on their own branch and trigger a deploy of
   whatever `refs/heads/main` currently points at.
3. **`preview` environment deployment branch policy** — Settings ->
   Environments -> `preview` -> Deployment branches: "Selected
   branches and tags" -> add `main` only. Under `pull_request_target`
   the preview flow already runs the main-branch workflow file, so
   restricting deployments to `main` is defense in depth.

Repository **variables** (Settings -> Secrets and variables -> Actions ->
Variables). These are inlined into the JS bundle at build time and are not
secret:

| variable                      | value                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_GRAPHQL_HOST`    | hostname only, no scheme — `api.explorer.penumbra.fi` (currently `api.explorer.rotko.net`) |
| `NEXT_PUBLIC_COMETBFT_WS_URL` | `wss://penumbra.rotko.net/websocket`                                                       |

Changing either one requires a rebuild, not just a host edit. Both have an
explicit fallback in the workflow, so leaving them unset keeps the current
rotko.net endpoints rather than baking an empty string into the bundle.

`PENUMBRA_INDEXER_CA_CERT` is empty on the host today, so no certificate has to
be carried anywhere; if it is ever set, put the file next to that colour's
`.env.production` and point the variable at that path.

`BASE_URL`, `PENUMBRA_GRPC_ENDPOINT`, `PENUMBRA_CHAIN_ID`,
`PENUMBRA_CUILOA_URL`, `PENUMBRA_INDEXER_ENDPOINT`,
`PENUMBRA_INDEXER_CA_CERT` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` are read at
**runtime** from `.env.production` / `.env.production.local` at
`/opt/penumbra-veil/{blue,green}/.env.production*` — one level above each
colour's `current` release symlink, alongside `env.port` (see the blue/green
section). Keep them `root:root 0600`: systemd reads `EnvironmentFile=` as PID 1
before dropping to `User=web`, so the service account never needs read access
to them, and the deploy account therefore cannot exfiltrate them over the same
ssh key it uses to ship releases. That placement matters: it's a sibling of the release tree, not
inside it, so it survives every deploy's `rsync --delete` and the build
job's own stripping of `.env*` out of the artifact. There is no single
shared directory across colours; each colour carries its own copy, kept in
sync by hand when a value changes. Set `BASE_URL=https://penumbra.fi` there
when the domain goes live — it is what canonical URLs and OpenGraph images
are built from.

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

## Blue/green (veil)

**Status: live.** This is how veil actually runs in production today — the
sections above describe the deploy automation this PR adds on top of an
already-running blue/green setup, not a design being proposed for the first
time.

Two systemd units, `penumbra-veil@blue` and `penumbra-veil@green`, run side
by side on the workload container from the templated unit
`deploy/systemd/penumbra-veil@.service`:

```
/opt/penumbra-veil/
  blue/
    env.port              PORT=3001, root-owned
    .env.production        colour-local runtime env, root-owned, NOT touched by CI
    .env.production.local  same
    releases/<git-sha>/    unpacked artifact, contains BUILD_INFO
    current -> releases/<git-sha>
  green/
    env.port              PORT=3002
    (same layout)
```

`.env.production*` sit _beside_ `current`, not inside it — the deploy
workflow's `rsync --delete` only ever touches `releases/<sha>/`, and the
build job deliberately strips any `.env*` out of the artifact, so anything
living inside the release tree would be gone on the very next deploy.

On the front-proxy container, `/etc/nginx/veil-upstream.conf` (written by
`veil-swap`, see `deploy/nginx-veil-upstream.conf.example`) defines two
upstreams — `veil` (active colour primary, other colour as nginx `backup`)
and `veil_staging` (standby colour) — and the `penumbra.fi` / `dex.rotko.net`
vhosts `include` it and `proxy_pass http://veil;`. `/usr/local/sbin/veil-swap`
(from `deploy/scripts/veil-swap.sh`) rewrites that include atomically,
`nginx -t` gates it, then `nginx -s reload` — graceful, no dropped
connections, no restart window. `veil-swap active` reports which colour is
currently prod; `/etc/nginx/veil-active` persists that across reloads.
`/etc/nginx/veil-backend-host` (optional) tells `veil-swap` the workload
container's address when nginx and veil are not on the same host, which in
this topology they are not — it must be set to
`VEIL_HOST=<workload host internal IP>` (the script's baked-in default,
`127.0.0.1`, is only correct if nginx and veil share a container).

### What the workflow does

1. `deploy-veil.yml` on `push: main` (or `workflow_dispatch` with
   `promote: auto`, the default): build → ask `proxy` which colour is active
   → rsync the artifact into the _other_ colour's `releases/<sha>` on
   `target` → flip that colour's `current` symlink → restart its unit →
   poll its port directly until it answers (up to 120s; it isn't serving
   traffic yet, so there's no rush) → `veil-swap <target>` on `proxy` →
   smoke test through nginx.
2. `workflow_dispatch` with `promote: staging-only` does the same but stops
   before the swap — the new build sits on the standby colour, reachable at
   its backend port and (once the staging vhost is enabled) at
   `staging.penumbra.fi`, while prod traffic stays on the old colour.
3. `promote-veil.yml` (`workflow_dispatch`, no build) just calls
   `veil-swap <standby>` — the same primitive, for when a `staging-only` run
   already checked out fine and someone says "ship it" without a rebuild.
   `dry_run: true` prints what would happen without swapping.

Rollback is `gh workflow run promote-veil.yml` again — the previous colour
is still running, untouched, so promoting back is instant.

### Out-of-band (manual) deploy

Shipping a locally built artifact without CI needs the tarball _inside the
workload container_: `scp` to the jump host only puts it in the host's `/tmp`,
which `pct exec` cannot see, so unpacking there fails with
`tar (child): … Cannot open: No such file or directory`. Use `pct push`:

```sh
scp veil-manual-<stamp>-<sha>.tar.zst root@<jump>:/tmp/
ssh root@<jump> bash -s <<'HOST'
set -euo pipefail
A=veil-manual-<stamp>-<sha>.tar.zst
pct push <vmid> "/tmp/$A" "/tmp/$A"
pct exec <vmid> -- bash -s <<'INNER'
set -euo pipefail
T=/opt/penumbra-veil/blue/releases/manual-<stamp>-<sha>
mkdir -p "$T"
tar --zstd -C "$T" -xf /tmp/veil-manual-<stamp>-<sha>.tar.zst
chown -R web:web "$T"
cd /opt/penumbra-veil/blue
ln -sfn "releases/manual-<stamp>-<sha>" current.tmp && mv -Tf current.tmp current
systemctl restart penumbra-veil@blue
INNER
HOST
```

Verify the way the workflow does: a 200 is not proof. Every chunk the served
HTML references must exist under `…/current/apps/veil/.next/static/chunks`,
and the unit's `MainPID` must have its cwd inside the release just linked.
Chunk names are content-hashed, so nearby builds share most of them — checking
one chunk, or only the first match, passes while a stale process serves a
different build.

### Staging vhost

`deploy/nginx-staging.penumbra.fi.conf.example` proxies `staging.penumbra.fi`
to the `veil_staging` upstream. **Status: live** (enabled on the front-proxy
container 2026-09-20). The record is Cloudflare-proxied, so CF terminates the
browser TLS and the origin reuses the `penumbra.fi` certificate (Full mode);
the vhost sends `X-Robots-Tag: noindex, nofollow`. `veil_staging` always
points at the standby colour, so `https://staging.penumbra.fi/` is whatever
the last `staging-only` (or pre-swap `auto`) deploy put there — check chunk
membership in the release tree before trusting it, a 200 alone is not proof.

### Host setup (blue/green pieces)

On the **workload container**:

```sh
# blue/green release layout + port pins (root-owned so `web` cannot rewrite them)
install -d -o web -g web /opt/penumbra-veil/blue/releases /opt/penumbra-veil/green/releases
printf 'PORT=3001\n' > /opt/penumbra-veil/blue/env.port
printf 'PORT=3002\n' > /opt/penumbra-veil/green/env.port
chmod 644 /opt/penumbra-veil/{blue,green}/env.port

# per-colour runtime env (values come from whatever the existing hand-managed
# .env.production was — copy it to BOTH colours, they diverge only if you
# deliberately want that)
# root-owned: systemd reads EnvironmentFile= as PID 1, `web` never needs it
install -o root -g root -m 600 .env.production.local /opt/penumbra-veil/blue/.env.production.local
install -o root -g root -m 600 .env.production.local /opt/penumbra-veil/green/.env.production.local
# .env.production similarly, if one exists

# templated unit
install -m 644 deploy/systemd/penumbra-veil@.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now penumbra-veil@blue.service penumbra-veil@green.service

# restart rights for the deploy account: only the two colour slots, nothing else
cat > /etc/sudoers.d/penumbra-deploy-veil <<'SUDO'
web ALL=(root) NOPASSWD: /usr/bin/systemctl restart penumbra-veil@blue.service, \
                         /usr/bin/systemctl restart penumbra-veil@green.service
SUDO
chmod 440 /etc/sudoers.d/penumbra-deploy-veil
visudo -c
```

On the **front-proxy container**:

```sh
install -o root -g root -m 0755 deploy/scripts/veil-swap.sh /usr/local/sbin/veil-swap
install -o root -g root -m 0644 deploy/nginx-veil-upstream.conf.example \
  /etc/nginx/veil-upstream.conf
# tell veil-swap where the workload container actually is
printf 'VEIL_HOST=<WORKLOAD_HOST_INTERNAL_IP>\n' > /etc/nginx/veil-backend-host
printf 'blue\n' > /etc/nginx/veil-active   # or whatever colour is actually live
# vhosts (deploy/nginx-penumbra.fi.conf.example) must `include
# /etc/nginx/veil-upstream.conf;` and `proxy_pass http://veil;`

# veil-swap rights for the deploy account, nothing else — the script itself
# validates its one argument, so this is as narrow as sudo gets
cat > /etc/sudoers.d/penumbra-deploy-veil-swap <<'SUDO'
web ALL=(root) NOPASSWD: /usr/local/sbin/veil-swap blue, \
                         /usr/local/sbin/veil-swap green, \
                         /usr/local/sbin/veil-swap active
SUDO
chmod 440 /etc/sudoers.d/penumbra-deploy-veil-swap
visudo -c

nginx -t && systemctl reload nginx
```

## Dev slot (`dev.penumbra.fi`) — shared WIP URL

**Status: not installed on either container.** The workflow is in
place; the host-side setup below is what actually stands the slot up.

Purpose: give the team a single always-fresh WIP URL. Every non-draft
PR redeploys it on push (last-write-wins), and any maintainer can
`gh workflow run deploy-dev.yml` from a WIP branch that isn't in a PR
yet. Frees `staging.penumbra.fi` from doubling as a scratch surface —
staging can then mean "main-branch pre-prod" the way its name
suggests, while dev is the shared scratch slot everyone's iterating
against.

Not per-PR-isolated. Two people racing PRs at the same time will
overwrite each other on the dev slot; that's a feature request for the
full per-PR previews infrastructure below, not something this slot
tries to solve. If you need concurrent PR previews, stand up the
previews section instead of / in addition to this.

### Layout

Third slot beside `blue`/`green` on the workload container:

```
/opt/penumbra-veil/
  blue/                   :3001
  green/                  :3002
  dev/
    env.port              PORT=3010, root-owned
    .env.production       runtime env (same shape as blue/green)
    .env.production.local same
    releases/<sha>/       unpacked artifact
    current -> releases/<sha>
```

Reuses the templated `penumbra-veil@.service` unit (`%i = dev`) — no
new unit file needed.

Port `3010` is outside blue/green (`3001`/`3002`), outside node-status
(`3003`), and outside the previews' reserved range (`30001-39999`).

### Front-proxy vhost

Direct `proxy_pass` to `<WORKLOAD_HOST>:3010`, gated by Cloudflare
Access at the zone level. Copy `deploy/nginx-dev.penumbra.fi.conf.example`,
fill in the backend include, add cert paths. Certbot for `dev.penumbra.fi`
(or reuse the wildcard `*.dev.penumbra.fi` cert if the previews section
is set up).

### Workflow triggers

- `workflow_dispatch` — "Use workflow from" chooses the build ref.
  Deploy checkout pins to `refs/heads/main`.
- `pull_request_target` (non-draft, non-fork, opened / synchronize /
  reopened / ready_for_review) — build checks out the PR head, deploy
  checkout is the PR base ref. Same `pull_request_target` posture as
  `preview-veil.yml`: the workflow file itself is always the merged
  version, composite actions in the build job come from
  `penumbrafi/web@main` (remote ref), and every setup step is in
  `save-cache: 'false'` restore-only mode so it cannot poison
  deploy-veil.yml's main-scope cache.

Reuses `production` secrets (`DEPLOY_SSH_KEY`, `DEPLOY_CT`,
`DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`) plus the repository-scoped
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. No new environment or secrets
required.

### One-time host setup (workload container)

```sh
# release layout + port pin (matches blue/green's structure)
install -d -o web -g web /opt/penumbra-veil/dev/releases
printf 'PORT=3010\n' > /opt/penumbra-veil/dev/env.port
chmod 644 /opt/penumbra-veil/dev/env.port

# runtime env — copy blue/green's values, kept in sync with them so
# the shared NEXT_SERVER_ACTIONS_ENCRYPTION_KEY still decrypts closures.
install -o root -g root -m 600 /opt/penumbra-veil/blue/.env.production.local \
                               /opt/penumbra-veil/dev/.env.production.local
# .env.production similarly, if one exists

# activate the dev instance from the same template unit blue/green use
systemctl enable --now penumbra-veil@dev.service

# add `dev` to the deploy account's restart list (append, do NOT replace
# the blue/green entries)
cat > /etc/sudoers.d/penumbra-deploy-veil <<'SUDO'
web ALL=(root) NOPASSWD: /usr/bin/systemctl restart penumbra-veil@blue.service, \
                         /usr/bin/systemctl restart penumbra-veil@green.service, \
                         /usr/bin/systemctl restart penumbra-veil@dev.service
SUDO
chmod 440 /etc/sudoers.d/penumbra-deploy-veil
visudo -c
```

### One-time nginx setup (front-proxy container)

```sh
# NEVER commit the internal upstream address. Write it to a root-owned
# include the vhost expects to exist.
cat > /etc/nginx/veil-dev-backend.conf <<'NGX'
set $veil_dev_upstream <WORKLOAD_HOST_INTERNAL_IP>:3010;
NGX
chmod 644 /etc/nginx/veil-dev-backend.conf

install -o root -g root -m 0644 \
        deploy/nginx-dev.penumbra.fi.conf.example \
        /etc/nginx/sites-available/dev.penumbra.fi
ln -sfn /etc/nginx/sites-available/dev.penumbra.fi /etc/nginx/sites-enabled/

# TLS: reuse the wildcard *.dev.penumbra.fi if the previews section is
# set up, or issue a specific-name cert:
#   certbot certonly --dns-cloudflare \
#     --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
#     -d dev.penumbra.fi

nginx -t && systemctl reload nginx
```

### DNS + Cloudflare Access

Add an A/AAAA record for `dev.penumbra.fi` on the Cloudflare zone,
proxied. In Cloudflare Zero Trust, add an Access application for
`dev.penumbra.fi` (or the whole `*.dev.penumbra.fi` zone if you want
this + previews to share a policy) with a maintainers-only Access
policy. Same "edge Access + origin CF-IP allowlist" pattern
`staging.penumbra.fi` already uses — the vhost example includes
`/etc/nginx/cloudflare-allowlist.conf` for exactly that.

### Coexistence with future per-PR previews

The previews section reserves `<pr>.dev.penumbra.fi` as a wildcard, so
this vhost (specific `dev.penumbra.fi`) and the wildcard can coexist
under the same DNS zone. Nginx matches specific `server_name`s before
falling through to the wildcard vhost.

## Per-PR previews (`<pr>.dev.penumbra.fi`)

**Status: not installed on either container.** This entire section is a
design that passed a security review but has no host-side footprint yet —
see "what remains" at the end. Nothing here touches the workload container's
existing veil blue/green setup or the front-proxy's existing vhosts; it is
fully additive.

Every open PR gets its own throwaway Veil at `https://<pr>.dev.penumbra.fi`,
built and torn down by `.github/workflows/preview-veil.yml`.

### Threat model

Anyone with commit access to this repo can open a PR that runs arbitrary
code inside the _build_ job. The preview infrastructure is designed so that
arbitrary code:

1. Never sees any secret. The build job runs with no environment secrets and
   `persist-credentials: false` on `actions/checkout`.
2. Never influences the _deploy_ job. The deploy and teardown jobs check out
   the PR's **base ref**, not its head, so `.github/actions/ssh-deploy` and
   every other composite action executes as its maintainer-merged version —
   the PR head has no way to alter what runs alongside `DEPLOY_SSH_KEY`.
3. Runs under a dedicated `web-preview` user with `InaccessiblePaths=` for
   every prod path, no network egress except localhost + a small allowlist,
   and a preview-only ssh key that can only invoke a wrapper granting
   `start|stop <pr>`.
4. Cannot be reached by the open internet — the whole `*.dev.penumbra.fi`
   zone sits behind Cloudflare Access. A preview URL that leaks into a Slack
   channel or a search index is still gated at CF's edge.

Fork PRs skip every job. `pull_request` on a fork cannot access `secrets` in
the first place, and the top-level `if:` on `guard` makes the failure
explicit rather than a red X halfway down the workflow.

These findings came out of a joint review round (redshiftzero /
danielmicay) on the original draft of this preview infrastructure; every
finding from that round maps to a specific hardening change already baked
into the files here (base-ref checkout for deploy/teardown, the dedicated
user + hardened unit, sudoers scoped to the wrapper only, the reserved port
range, CF Access as a second gate). Nothing in this consolidation loosens
any of that — paths were updated for CT1199, the security posture was not
touched.

### Host layout

```
/opt/penumbra-veil-previews/
  etc/                        root-owned; contains env.preview and env.<pr>
    env.preview               shared defaults, 0640 root:web-preview
    env.<pr>                  per-PR overrides, same mode
  <pr>/                       created by CI as web-preview; wiped on teardown
    releases/<sha>/           unpacked artifact
    current -> releases/<sha> symlink flipped atomically
```

`etc/` sits _outside_ every `<pr>/` and is not writable by the CI account, so
a compromised preview cannot swap `env.preview` for a symlink to
`/etc/letsencrypt/cloudflare.ini` and have PID 1 read it back as environment
variables.

### Ports and network

PR numbers are gated to `1..9999` in the workflow and re-validated by both
`preview-ctl` and the launcher script; the port range is therefore
`30001..39999` — outside veil's blue/green range (`3001`/`3002`) and
node-status's placeholder (`3003`). **Reserve this range on the workload
container** so the kernel never hands out one of our preview ports as an
ephemeral outbound source port and lets an unrelated process squat on it:

```
/etc/sysctl.d/10-veil-previews.conf:
    net.ipv4.ip_local_reserved_ports = 30001-39999
```

### DNS + TLS

DNS is a single wildcard `*.dev.penumbra.fi` A/AAAA on the Cloudflare zone,
CF-proxied. Cloudflare Access sits in front as an SSO gate for the whole
`*.dev` zone.

**CF Access alone is edge-only.** An attacker who resolves the anycast IP
directly (`curl --resolve <fqdn>:443:<origin-ip>`) bypasses Access
completely — the origin never sees the CF session cookie, so it happily
serves the request. The deploy ships a companion origin-side gate,
`/etc/nginx/cloudflare-allowlist.conf`, that every gated vhost includes
and enforces via `if ($cf_gated_allowed = "0") { return 403; }`. Refresh
the Cloudflare IP ranges (see the file's header comment) once a quarter
and after any published change to CF's IP list. Together — CF Access at
the edge, IP allowlist at the origin — no anonymous request reaches the
gated origin.

TLS is a Let's Encrypt wildcard issued via `certbot-dns-cloudflare` on the
front-proxy container — the only place the Cloudflare API is touched from a
host. Certbot renews on its systemd timer.

The Cloudflare token wants **`Zone.DNS:Edit` on the `penumbra.fi` zone
only**. Do not use a global token. `/etc/letsencrypt/cloudflare.ini`, mode
`600`, root-owned.

### Secrets and variables

`preview` environment secrets:

| secret               | notes                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | **preview-only** ed25519 key. Not the prod key, not scoped to the front-proxy container at all.                        |
| `DEPLOY_HOST`        | jump host public address (can be the same jump host as `production`; the account and its `permitopen` are what differ) |
| `DEPLOY_CT`          | workload container internal address                                                                                    |
| `DEPLOY_KNOWN_HOSTS` | same pinned host keys as `production` for the jump host and workload container                                         |

Repository variable:

| variable       | value             |
| -------------- | ----------------- |
| `PREVIEW_ZONE` | `dev.penumbra.fi` |

### One-time host setup (workload container)

```sh
# dedicated user; owns per-PR trees but nothing else
adduser --system --home /var/lib/web-preview --shell /usr/sbin/nologin \
        --disabled-password web-preview

# release root, split into a CI-writable per-PR area and a root-only etc/
install -d -o root -g root         -m 0755 /opt/penumbra-veil-previews
install -d -o root -g web-preview  -m 0750 /opt/penumbra-veil-previews/etc
# Move any real env files into etc/, root-owned, mode 0640.

# authorized_keys for the preview-only key, restricted at the ssh layer
install -d -o web-preview -g web-preview -m 0700 /home/web-preview/.ssh
cat > /home/web-preview/.ssh/authorized_keys <<'KEY'
restrict,pty ssh-ed25519 AAAA...  github-actions penumbrafi preview
KEY
chown web-preview:web-preview /home/web-preview/.ssh/authorized_keys
chmod 600 /home/web-preview/.ssh/authorized_keys

# root-owned launcher + wrapper. Never install these from user paths.
install -o root -g root -m 0755 \
        deploy/scripts/penumbra-veil-preview-run.sh /usr/local/sbin/penumbra-veil-preview-run
install -o root -g root -m 0755 \
        deploy/scripts/preview-ctl.sh              /usr/local/sbin/preview-ctl

# sudoers: web-preview may call exactly the wrapper, nothing else. The
# wrapper does its OWN validation of $2 (PR number), so the digit-glob in
# the sudoers pattern is defence-in-depth, not the only check.
cat > /etc/sudoers.d/penumbra-veil-preview <<'SUDO'
Defaults!/usr/local/sbin/preview-ctl env_reset
web-preview ALL=(root) NOPASSWD: /usr/local/sbin/preview-ctl start [1-9]*, \
                                 /usr/local/sbin/preview-ctl stop  [1-9]*
SUDO
chmod 440 /etc/sudoers.d/penumbra-veil-preview
visudo -c

# systemd template unit
install -o root -g root -m 0644 \
        deploy/systemd/penumbra-veil-preview@.service /etc/systemd/system/
systemctl daemon-reload

# sysctl for the reserved port range
install -o root -g root -m 0644 - /etc/sysctl.d/10-veil-previews.conf <<'SYSCTL'
net.ipv4.ip_local_reserved_ports = 30001-39999
SYSCTL
sysctl --system
```

### One-time nginx setup (front-proxy container)

The wildcard vhost lives on the front-proxy container, not the workload
container — CF Access is in front of the front-proxy, and the front-proxy is
the machine that already terminates TLS for `*.penumbra.fi`.

```sh
apt-get install -y libnginx-mod-http-lua certbot python3-certbot-dns-cloudflare

# NEVER commit the internal upstream IP. Write it to a root-owned include
# that the vhost expects to exist. If the file is missing nginx refuses to
# start rather than proxying to a default host.
cat > /etc/nginx/veil-previews-upstream.conf <<'NGX'
set $preview_upstream <WORKLOAD_HOST_INTERNAL_IP>;
NGX
chmod 644 /etc/nginx/veil-previews-upstream.conf

install -o root -g root -m 0644 \
        deploy/nginx-veil-previews.conf.example \
        /etc/nginx/sites-available/veil-previews.penumbra.fi
ln -sfn /etc/nginx/sites-available/veil-previews.penumbra.fi /etc/nginx/sites-enabled/

# wildcard cert; the CF token file is /etc/letsencrypt/cloudflare.ini
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d '*.dev.penumbra.fi' -d dev.penumbra.fi

nginx -t && systemctl reload nginx
```

### Cloudflare Access

In the Cloudflare Zero Trust dashboard, add an Access application for the
zone `*.dev.penumbra.fi` (session duration ~24h) with a policy that requires
membership in the maintainers' identity group. Nothing about this is in the
workflow; CF Access sits in front of the origin, so it gates the vhost
before any Lua parses the Host header. This is the control that makes it
safe to auto-post preview URLs into PR comments.

### Teardown

`preview-veil.yml` fires on `pull_request: closed` (both merged and closed
without merge), calls `sudo preview-ctl stop <pr>`, which stops + disables
`penumbra-veil-preview@<pr>.service` and `rm -rf`s
`/opt/penumbra-veil-previews/<pr>/`. If a preview leaks (workflow cancelled
between activate and teardown, network flake, etc.), find it:

```sh
systemctl list-units 'penumbra-veil-preview@*.service' --all
ls /opt/penumbra-veil-previews/
```

and run `sudo preview-ctl stop <pr>` per orphan.

## Known unverified

- GitHub-hosted runners reaching the jump host on `:22` — not yet exercised
  from a runner IP.
- Whether veil's native dependency `canvas` loads on the host if built on
  `ubuntu-latest` (glibc 2.39) against a Debian bookworm target (glibc 2.36).
  If `server.js` fails on the first deploy with a `GLIBC_` or `.node` loader
  error, switch the build job to `container: node:22-bookworm`.

## What's already applied / what remains

Applied by hand, already live in production:

- Blue/green systemd units (`penumbra-veil@blue`, `penumbra-veil@green`) on
  the workload container.
- `veil-swap` and `veil-upstream.conf` on the front-proxy container.
- The front-proxy vhosts for `penumbra.fi` and `dex.rotko.net`, routed through
  `veil-upstream.conf`.
- The staging `veil-upstream.conf` include mechanics (i.e. `veil_staging`
  always points at the standby colour) and the `staging.penumbra.fi` vhost
  behind it (Cloudflare-proxied, origin reuses the `penumbra.fi` cert,
  `noindex`).
- The forwarding-only `deploy-jump` account, its per-repo keypair and
  `permitopen`/`PermitOpen` confinement.
- The `production` environment secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`,
  `DEPLOY_CT`, `DEPLOY_PROXY_CT`, `DEPLOY_KNOWN_HOSTS`) and the repository
  secret `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- The deploy account's `authorized_keys` in the workload container and in the
  front-proxy container, and the `penumbra-deploy-veil` /
  `penumbra-deploy-veil-swap` sudoers files.
- Per-colour `releases/` directories and root-owned
  `.env.production.local` beside each `current`.

### Transitional drop-in

Before CI owned this deploy, both colours' `current` pointed at one shared,
hand-built _full workspace_ checkout started with `npx next start`, not at a
per-colour standalone tree started with `node server.js`. Installing the unit
template above would therefore kill any colour that crash-restarts before its
first CI deploy. Each colour carries a drop-in at
`/etc/systemd/system/penumbra-veil@<colour>.service.d/legacy-checkout.conf`
that runs `node server.js` when the release tree has one and falls back to
`npx next start` when it does not, and re-reads the old in-tree env files.

It is self-clearing in effect: the first CI deploy to a colour ships
`server.js`, after which the drop-in only ever takes the `node server.js`
branch. Delete it once both colours have had a CI deploy.

The legacy non-templated `penumbra-veil.service` — the shared hand-built
checkout at `/opt/penumbra-web`, started with `npx next start -p 3001` — has
been retired: unit file and drop-in directory renamed to `.disabled`, unit
stopped, so `systemctl start penumbra-veil.service` no longer resolves. It had
to go because its `20-free-port.conf` `ExecStartPre` kills whatever holds
:3001: while it ran, every `penumbra-veil@blue` start died with `EADDRINUSE`
(4829 restarts) and :3001 kept serving a build from hours earlier.

Not yet applied — required before `gh workflow run deploy-veil.yml` will work
end-to-end:

- node-status host setup (release dir exists nowhere, no vhost).
- Everything under the dev-slot section: `/opt/penumbra-veil/dev/`,
  `env.port=3010`, `.env.production.local` copy, `penumbra-veil@dev`
  systemd enable, sudoers extension, `dev.penumbra.fi` DNS + Cloudflare
  Access + vhost + TLS cert.
- Everything under the per-PR previews section (dedicated user, wildcard
  vhost, wildcard cert, Cloudflare Access, sysctl reservation).

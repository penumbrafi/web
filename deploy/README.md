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

* **Front-proxy container (CT1102)** — nginx, TLS termination, anycast entry
  point for `penumbra.fi` and `dex.rotko.net`. Holds `veil-upstream.conf`
  (blue/green routing, see below), the `veil-swap` helper, and (once set up)
  the per-PR previews wildcard vhost + Cloudflare Access front door.
* **Node.js workload container (CT1199)** — runs the veil `blue`/`green`
  systemd units. This is also where node-status would run once deployed, and
  where the per-PR preview units run (see the previews section).

Wherever this README needs an address, port, or key it says
`<FRONT_PROXY_HOST>` / `<WORKLOAD_HOST>` / etc. and points at the secret that
actually holds the value on the day someone runs the one-time host setup.

## Transport

**Two containers, not one.** The workload container (runs the veil units) and
the front-proxy container (runs nginx and `veil-swap`) are different boxes on
the internal network. `.github/actions/ssh-deploy` sets up a jump host and
proxies to *either or both*, as `target` and `proxy` respectively — pass
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
| `DEPLOY_PROXY_CT` | address of the front-proxy container on the internal network |
| `DEPLOY_KNOWN_HOSTS` | pinned host keys for the jump host, the workload container, and the front-proxy container — generate with `ssh-keyscan`, do not paste keys from this README into an issue or elsewhere public |

`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_CT` and `DEPLOY_KNOWN_HOSTS` are also
needed by `penumbra-explorer` and `penumbra-explorer-backend` (they don't talk
to the front-proxy container, so they don't need `DEPLOY_PROXY_CT`) — as an
org admin you can instead create those four once as **organization** secrets
scoped to those repositories.

`preview` environment secrets are documented in the per-PR previews section
below.

### Branch protection and tag rulesets (required)

The deploy workflows pin their checkouts to `refs/heads/main` so a tag
push or a `workflow_dispatch` from any branch cannot ship a version of
`.github/actions/ssh-deploy` written by an attacker. That pin is only
meaningful when combined with:

1. **Branch protection on `main`** — Settings -> Branches -> Add rule:
   require pull request review before merge, require the `Turbo CI`
   status check to pass, and *disable* force pushes. Otherwise anyone
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

| variable | value |
| --- | --- |
| `NEXT_PUBLIC_GRAPHQL_HOST` | hostname only, no scheme — `api.explorer.penumbra.fi` (currently `api.explorer.rotko.net`) |
| `NEXT_PUBLIC_COMETBFT_WS_URL` | `wss://penumbra.rotko.net/websocket` |

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
section). That placement matters: it's a sibling of the release tree, not
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

`.env.production*` sit *beside* `current`, not inside it — the deploy
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
   → rsync the artifact into the *other* colour's `releases/<sha>` on
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

### Staging vhost

`deploy/nginx-staging.penumbra.fi.conf.example` proxies `staging.penumbra.fi`
to the `veil_staging` upstream. **Status: include installed on the front-proxy
container, vhost not enabled** — it needs a DNS record and a certificate for
`staging.penumbra.fi` first. Until then, `staging-only` deploys are only
reachable by curling the standby colour's backend port directly from inside
the workload container.

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
install -o web -g web -m 600 .env.production       /opt/penumbra-veil/blue/.env.production
install -o web -g web -m 600 .env.production       /opt/penumbra-veil/green/.env.production
# .env.production.local similarly, if one exists

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
code inside the *build* job. The preview infrastructure is designed so that
arbitrary code:

1. Never sees any secret. The build job runs with no environment secrets and
   `persist-credentials: false` on `actions/checkout`.
2. Never influences the *deploy* job. The deploy and teardown jobs check out
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

`etc/` sits *outside* every `<pr>/` and is not writable by the CI account, so
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

| secret | notes |
| --- | --- |
| `DEPLOY_SSH_KEY` | **preview-only** ed25519 key. Not the prod key, not scoped to the front-proxy container at all. |
| `DEPLOY_HOST` | jump host public address (can be the same jump host as `production`; the account and its `permitopen` are what differ) |
| `DEPLOY_CT` | workload container internal address |
| `DEPLOY_KNOWN_HOSTS` | same pinned host keys as `production` for the jump host and workload container |

Repository variable:

| variable | value |
| --- | --- |
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

* GitHub-hosted runners reaching the jump host on `:22` — not yet exercised
  from a runner IP.
* Whether veil's native dependency `canvas` loads on the host if built on
  `ubuntu-latest` (glibc 2.39) against a Debian bookworm target (glibc 2.36).
  If `server.js` fails on the first deploy with a `GLIBC_` or `.node` loader
  error, switch the build job to `container: node:22-bookworm`.

## What's already applied / what remains

Applied by hand, already live in production:

* Blue/green systemd units (`penumbra-veil@blue`, `penumbra-veil@green`) on
  the workload container.
* `veil-swap` and `veil-upstream.conf` on the front-proxy container.
* The front-proxy vhosts for `penumbra.fi` and `dex.rotko.net`, routed through
  `veil-upstream.conf`.
* The staging `veil-upstream.conf` include mechanics (i.e. `veil_staging`
  always points at the standby colour).

Not yet applied — required before `gh workflow run deploy-veil.yml` will work
end-to-end:

* The forwarding-only jump account described above (today only a full-root
  SSH path exists).
* The `production` and `preview` GitHub Environments and their secrets,
  including `DEPLOY_PROXY_CT` (this PR's workflows are the first thing that
  needs to reach the front-proxy container separately from the workload
  container — nothing before this automated the swap step).
* The `penumbra-deploy-veil` / `penumbra-deploy-veil-swap` sudoers files
  above, scoped to whatever account `DEPLOY_SSH_KEY` authenticates as.
* Per-colour `.env.production*` living beside `current` rather than inside
  it, if the host's current copies are not already there (verify before the
  first CI-driven deploy, or the app will come up with empty runtime config).
* node-status host setup (release dir exists nowhere, no vhost).
* Everything under the per-PR previews section (dedicated user, wildcard
  vhost, wildcard cert, Cloudflare Access, sysctl reservation).
* `staging.penumbra.fi` DNS + certificate (the vhost example and the
  upstream mechanics are ready; the name isn't resolvable yet).

# Deploying the penumbrafi frontends

Everything in this directory is *documentation and host configuration*. The
build always happens in GitHub Actions from `main` or a tag — there are no
hand-built artifacts on the server and no magic binaries.

## What ships from this repo

| app | workflow | artifact | host path | served on |
| --- | --- | --- | --- | --- |
| veil | `.github/workflows/deploy-veil.yml` | `veil-<sha>.tar.zst` (Next.js standalone) | `/opt/penumbra-veil` | `penumbra.fi`, alias `dex.rotko.net` (`:3001`, systemd) |
| node-status | `.github/workflows/deploy-node-status.yml` | `node-status-<sha>.tar.zst` (Vite `dist/`) | `/opt/penumbra-node-status` | `status.penumbra.fi` (`:3002`, CT1105 nginx) |

`minifront` is **not** deployed from here. It lives on `app.antumbra.net` and
is out of scope; it is still built and linted by `turbo-ci.yml`.

`turbo-ci.yml` (plus `compile-wasm.yml`, which it calls) is the PR lint/test
workflow and is unchanged apart from moving off BuildJet runners onto
`ubuntu-latest`.

## Release layout on the host (blue/green)

```
/opt/penumbra-veil/
  active                        one-line file: "blue" or "green"; nginx
                                sends prod traffic to whichever this
                                names. Rewritten by veil-swap.
  shared/.env.production        host-owned, never touched by CI
  shared/.env.production.local  host-owned, never touched by CI
  blue/
    env.port                    PORT=3001, root-owned
    releases/<git-sha>/         unpacked artifacts
    current -> releases/<sha>
  green/
    env.port                    PORT=3002, root-owned
    releases/<git-sha>/
    current -> releases/<sha>
```

Two independent instances, `penumbra-veil@blue.service` on `:3001` and
`penumbra-veil@green.service` on `:3002`, both always running. Nginx's
`/etc/nginx/veil-upstream.conf` names the currently-active colour as the
primary upstream and the other as a `backup` fallback:

```
upstream veil {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002 backup;
    keepalive 32;
}
```

Deploy is:

1. rsync the artifact into the **non-active** colour's `releases/<sha>`
   and flip its `current` symlink;
2. `systemctl restart penumbra-veil@<target>` — the target is not
   receiving traffic yet, so the restart is not visible to anyone;
3. curl-loop the target's port until it answers (up to 120s);
4. `veil-swap <target>` rewrites the nginx upstream include and does
   `nginx -s reload` — graceful; in-flight requests to the old colour
   finish on the old worker, new connections go to the new colour;
5. old colour keeps running as the free rollback.

`rsync --delete` only runs *inside* the target's `releases/<sha>`, so
`shared/` and every `.env*` on the host survive untouched.

### Rollback

```
sudo /usr/local/sbin/veil-swap {blue|green}
```

Points nginx back at whichever colour is still running the last-good
build. `nginx -s reload` again — no restart, no dropped requests.

### Staging URL

`staging.penumbra.fi` is a companion vhost (see
`deploy/nginx-staging.penumbra.fi.conf.example`) that proxies to the
`veil_staging` upstream. `veil-swap` keeps that upstream pointed at
whichever colour is currently *not* serving prod, so:

- Right after a normal `deploy-veil.yml auto` run, staging and prod
  serve the same build (the old colour drained into the pool).
- After a `deploy-veil.yml staging-only` run, staging serves the new
  build and prod serves the previous one. Inspect at
  `https://staging.penumbra.fi`, then `gh workflow run promote-veil.yml`
  when happy.

Gate the staging zone behind Cloudflare Access (or basic auth); an
unshipped build should never be anonymously reachable.

### Manual invocation via `gh`

```sh
# ship main to prod, zero-downtime
gh workflow run deploy-veil.yml

# ship main to STAGING only — inspect at staging.penumbra.fi,
# prod stays on the previous colour
gh workflow run deploy-veil.yml -f promote=staging-only

# promote whatever is currently on staging → prod
gh workflow run promote-veil.yml

# see what would be promoted without doing it
gh workflow run promote-veil.yml -f dry_run=true
```

## Transport

CT1105 has sshd on `:22` but only an internal address (`10.6.78.85/16`), so
Actions reaches it with `ProxyJump` through the bkk06 hypervisor:

```
runner --ssh--> deploy-jump@<bkk06 public ip> --(-W)--> web@10.6.78.85
```

The jump account is forwarding-only: no shell, and `permitopen` restricted to
the container. `.github/actions/ssh-deploy` sets this up and verifies the hop
before anything is copied.

## Secrets and variables to create

Create a GitHub **Environment** named `production` in
`penumbrafi/web` (Settings -> Environments -> New environment) and add these as
*environment* secrets. The same four are needed by `penumbra-explorer` and
`penumbra-explorer-backend` — as an org admin you can instead create them once
as **organization** secrets scoped to those three repositories:

| secret | value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the ed25519 **private** key generated below, PEM body included |
| `DEPLOY_HOST` | public address of bkk06 (`160.22.180.6`) |
| `DEPLOY_CT` | address of CT1105 on the internal network (`10.6.78.85`) |
| `DEPLOY_KNOWN_HOSTS` | the two pinned host keys, see below |

`DEPLOY_KNOWN_HOSTS` (host keys read from the machines on 2026-09-07):

```
160.22.180.6 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMFjR7GW0By58m5FH+OBZ95VBB5ojplZa8C5UmjV731b
10.6.78.85 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBAWg1G4VempqSlmJtB+1XItpF7fHD8x+A3SBgJA0VQ1
```

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

## One-time host setup

Generate the deploy key on a workstation (never on the server, never commit it):

```sh
ssh-keygen -t ed25519 -C 'github-actions penumbrafi deploy' -f ~/.ssh/penumbrafi_deploy -N ''
```

Put the private key in `DEPLOY_SSH_KEY`. Then, as root on bkk06:

```sh
# forwarding-only jump account
adduser --system --shell /usr/sbin/nologin --home /var/lib/deploy-jump deploy-jump
install -d -m 700 -o deploy-jump -g nogroup /var/lib/deploy-jump/.ssh
cat > /var/lib/deploy-jump/.ssh/authorized_keys <<'KEY'
restrict,port-forwarding,permitopen="10.6.78.85:22" ssh-ed25519 AAAA...  github-actions penumbrafi deploy
KEY
chown deploy-jump:nogroup /var/lib/deploy-jump/.ssh/authorized_keys
chmod 600 /var/lib/deploy-jump/.ssh/authorized_keys
```

And inside CT1105 (`ssh bkk06 'pct exec 1105 -- bash'`):

```sh
# tools the deploy needs; neither is installed today
apt-get update && apt-get install -y rsync zstd

# the deploy account is the existing `web` user that already owns /opt/*
install -d -m 700 -o web -g web /home/web/.ssh
cat > /home/web/.ssh/authorized_keys <<'KEY'
ssh-ed25519 AAAA...  github-actions penumbrafi deploy
KEY
chown web:web /home/web/.ssh/authorized_keys
chmod 600 /home/web/.ssh/authorized_keys

# restart rights: only the two colour slots for veil, plus veil-swap
# (which itself validates its single argument). Nothing else.
cat > /etc/sudoers.d/penumbra-deploy <<'SUDO'
web ALL=(root) NOPASSWD: /usr/bin/systemctl restart penumbra-veil@blue.service, \
                         /usr/bin/systemctl restart penumbra-veil@green.service, \
                         /usr/bin/systemctl restart penumbra-explorer-frontend.service, \
                         /usr/bin/systemctl restart penumbra-explorer.service, \
                         /usr/local/sbin/veil-swap blue, \
                         /usr/local/sbin/veil-swap green, \
                         /usr/local/sbin/veil-swap active
SUDO
chmod 440 /etc/sudoers.d/penumbra-deploy
visudo -c

# blue/green release layout
install -d -o web -g web /opt/penumbra-veil/shared /opt/penumbra-veil/blue/releases /opt/penumbra-veil/green/releases
# port pins per colour, root-owned so the web user cannot rewrite them
printf 'PORT=3001\n' > /opt/penumbra-veil/blue/env.port
printf 'PORT=3002\n' > /opt/penumbra-veil/green/env.port
chmod 644 /opt/penumbra-veil/{blue,green}/env.port
# start on blue by convention
printf 'blue\n' > /opt/penumbra-veil/active

install -d -o web -g web /opt/penumbra-node-status/releases

# move the existing hand-managed env files under shared/ (values unchanged)
cp -a /opt/penumbra-web/apps/veil/.env.production       /opt/penumbra-veil/shared/
cp -a /opt/penumbra-web/apps/veil/.env.production.local /opt/penumbra-veil/shared/
chown web:web /opt/penumbra-veil/shared/.env.production*
chmod 600 /opt/penumbra-veil/shared/.env.production*

# install the templated unit + the swap wrapper
install -m 644 deploy/systemd/penumbra-veil@.service /etc/systemd/system/
install -o root -g root -m 0755 deploy/scripts/veil-swap.sh /usr/local/sbin/veil-swap
rm -rf /etc/systemd/system/penumbra-veil.service.d   # legacy drop-in folded into the unit
# retire the pre-blue/green single instance if present
systemctl disable --now penumbra-veil.service 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now penumbra-veil@blue.service penumbra-veil@green.service

# nginx upstream include (initial version points at blue only)
install -o root -g root -m 0644 deploy/nginx-veil-upstream.conf.example \
  /etc/nginx/veil-upstream.conf
# The vhost that fronts penumbra.fi (in CT1102, see
# deploy/nginx-penumbra.fi.conf.example) must `include
# /etc/nginx/veil-upstream.conf;` at top level and `proxy_pass http://veil;`
# inside its location block.

# static host for node-status
install -m 644 deploy/nginx-ct1105-static.conf.example \
  /etc/nginx/sites-available/penumbra-static
ln -sfn /etc/nginx/sites-available/penumbra-static /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

The old in-place checkout at `/opt/penumbra-web` stays where it is until the
first CI deploy is verified; nothing in this repo writes to it any more.

Finally, in CT1102, add the vhosts from `deploy/nginx-penumbra.fi.conf.example`
once `penumbra.fi` is delegated and certificates are issued. Nothing here
touches nginx or haproxy automatically.

## Known unverified

* GitHub-hosted runners reaching bkk06 on `:22` — the nftables ruleset accepts
  `tcp dport 22` from `0.0.0.0/0`, but this has not been exercised from a
  runner IP.
* `node-status` served at `status.penumbra.fi` uses same-origin gRPC-web
  (`prodBaseUrl = '/'`), so the vhost must proxy `/penumbra.*` to the node —
  included in the nginx example but not yet exercised. If the restart board is
  wanted at that name instead, drop `deploy-node-status.yml`.
* Whether veil's native dependency `canvas` loads on the host. The build runs
  on `ubuntu-latest` (glibc 2.39) while CT1105 is Debian bookworm (glibc 2.36).
  If `server.js` fails on the first deploy with a `GLIBC_` or `.node` loader
  error, switch the build job to `container: node:22-bookworm`.

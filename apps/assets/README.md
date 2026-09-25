# Penumbra Assets

Internal dashboard at https://assets.penumbra.fi charting the historical
shielded balance of every asset on penumbra-1, plus UM total supply. Reads the
pindexer Postgres directly; no wallet, no Prax, no auth in the app (nginx
basic auth sits in front).

## What it shows

- **UM total supply** over time, sampled every 8,640 blocks (~12 h).
- **Every asset with a shielded-pool row**, sorted by what is shielded now:
  symbol, current value, lifetime inflow, unique depositors, last change
  height, and whether the asset id is in the bundled registry.
- **Per-asset step chart** of `current_value` (click a row or use the
  select), linear/log toggle, 30d / 90d / 1y / all range.
- **Top-8 comparison**: the largest balances on one axis, indexed to 100 at
  the start of the range or on a log axis. Eight is the categorical palette's
  validated limit, so this is "top ~10" rounded down rather than a ninth hue.

## Data

Everything comes from three pindexer tables via `/api/*` route handlers
(`src/db/queries.ts`), memoised in-process for 5 minutes and served with
`s-maxage=300`:

| table                    | use                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `insights_shielded_pool` | sparse change log per asset: a row only when the value changed. `current_value` / `total_value` are base-unit text.     |
| `block_details`          | `height -> timestamp` for the x axis.                                                                                   |
| `insights_supply`        | one row per block (12.9M). Always downsampled in SQL: `generate_series(min, max, 8640)` joined on the PK, plus the tip. |

Because the pool table is sparse, every series is a **step function** and is
drawn with `stepAfter`. `src/lib/series.ts` holds the pure helpers (tested
with fixtures in `series.test.ts`): clipping a range prepends the value
carried in from before the window and extends the last step to the latest
indexed block; the comparison view forward-fills onto the union timeline,
with "did not exist yet" as `null` (never zero, which is a real value).

Amounts are scaled from base units with BigInt division (`src/lib/amount.ts`)
because 18-decimal assets exceed 2^53; only the final display value is a
float.

Asset ids resolve through the bundled `@penumbrafi/registry`. Ids the registry
does not know get exponent 0, the raw base64 id as symbol and a "not in
registry" badge; two known cases (`transfer/channel-1/adydx`,
`transfer/channel-4/gamm/pool/1402`, both 18 decimals) have a hardcoded
fallback in `src/lib/assets.ts`.

## Running

```sh
cp apps/assets/.env.example apps/assets/.env.local   # set PENUMBRA_INDEXER_ENDPOINT
pnpm --filter penumbra-assets dev                    # http://localhost:3000
pnpm --filter penumbra-assets test                   # vitest, no database needed
pnpm --filter penumbra-assets lint:strict            # tsc + eslint
pnpm turbo build --filter=penumbra-assets...         # standalone build
```

Without a reachable database the page still renders and every chart shows an
explicit "Indexer unreachable" state; `/api/*` answer 503 with
`{ "error": "indexer_unreachable" }`. The Postgres pool has a 5 s connect
timeout and a 30 s statement timeout so a dead indexer fails fast.

## Deploy

`.github/workflows/deploy-assets.yml` builds on push to `main` touching
`apps/assets/**` (or `workflow_dispatch`), packs the Next.js standalone tree
as `assets-<sha>.tar.zst`, rsyncs it to
`/opt/penumbra-assets/releases/<sha>/` on the workload container through the
shared `ssh-deploy` action, flips the `current` symlink, restarts
`penumbra-assets.service` and health-checks `http://127.0.0.1:3004/` there.
No blue/green.

Layout on the workload container (see `deploy/systemd/penumbra-assets.service`):

```
/opt/penumbra-assets/
  .env.production          root:root 0600 — PENUMBRA_INDEXER_ENDPOINT, PORT=3004
  current -> releases/<sha>
  releases/<sha>/apps/assets/server.js
```

One-time host setup, not yet applied when this app was added:

```sh
install -d -o web -g web /opt/penumbra-assets/releases
install -o root -g root -m 600 .env.production /opt/penumbra-assets/.env.production
install -m 644 deploy/systemd/penumbra-assets.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable penumbra-assets.service
cat > /etc/sudoers.d/penumbra-deploy-assets <<'SUDO'
web ALL=(root) NOPASSWD: /usr/bin/systemctl restart penumbra-assets.service
SUDO
chmod 440 /etc/sudoers.d/penumbra-deploy-assets && visudo -c
```

On the front-proxy container, an `assets.penumbra.fi` vhost with
`auth_basic` and `proxy_pass http://<WORKLOAD_HOST>:3004;`. Port 3003 on the
workload container belongs to the airdrop app.

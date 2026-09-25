'use server';

import { QueryService } from '@penumbra-zone/protobuf/penumbra/core/component/community_pool/v1/community_pool_connect';
import { createClient } from '@/shared/utils/protos/utils';
import { ChainRegistryClient } from '@penumbrafi/registry';

// Community-pool balance is NOT indexed by pindexer. `supply_total_unstaked.um`
// folds the pool's genesis allocation and every funding-stream reward into
// the same bucket as wallets, so we can't peel it out of the schema. The
// authoritative source is the pd node's CommunityPoolAssetBalances stream;
// filter by the UM asset id and take the first (and, today, only) result.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — pool balance moves at
// funding-stream cadence (once per epoch, ~48 hours), so a 10 min cache
// is plenty.

interface CommunityPoolBalance {
  um: number;
  fetchedAt: Date;
}

let cached: CommunityPoolBalance | null = null;
let inflightAt = 0;

export async function fetchCommunityPoolUM(): Promise<number | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached.um;
  }
  if (now - inflightAt < 5_000) {return cached?.um ?? null;}
  inflightAt = now;

  // Fall back to the public rotko pd endpoint if neither env var is set —
  // the tokenomics page has been shipping with the CP band collapsed to
  // zero in prod because whoever provisioned the workload container
  // didn't set PENUMBRA_GRPC_ENDPOINT in the systemd EnvironmentFile,
  // and the built artifact strips .env* on deploy. Baking a working
  // default here means the page renders the CP bucket out of the box;
  // operators who want to point at an internal pd (loopback, mesh IP)
  // still override it via PENUMBRA_GRPC_ENDPOINT_INTERNAL and skip the
  // public round-trip.
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL']
    ?? process.env['PENUMBRA_GRPC_ENDPOINT']
    ?? 'https://penumbra.rotko.net';

  try {
    // Reuse the registry's bundled staking asset id — same source as the
    // rest of the app (fetch-registry.ts, transport.ts). Prevents drift if
    // upstream ever changes the id.
    const stakingAssetId = new ChainRegistryClient().bundled.globals().stakingAssetId;
    const client = createClient(grpcEndpoint, QueryService);

    let umBalance = 0n;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 4_000);
    try {
      for await (const res of client.communityPoolAssetBalances(
        { assetIds: [stakingAssetId] },
        { signal: abort.signal },
      )) {
        // Response is one Balance per matching asset. We asked for exactly
        // UM so there's expected to be at most one iteration, but iterate
        // defensively in case the pd node ignores the filter.
        const inner = res.balance?.assetId?.inner;
        if (!inner) {continue;}
        // Compare bytes against the UM asset id.
        if (inner.length !== stakingAssetId.inner.length) {continue;}
        let match = true;
        for (let i = 0; i < inner.length; i++) {
          if (inner[i] !== stakingAssetId.inner[i]) {
            match = false;
            break;
          }
        }
        if (!match) {continue;}
        const amt = res.balance?.amount;
        if (!amt) {continue;}
        // Amount is a u128 split into lo (u64) + hi (u64). Community-pool
        // balance is at most ~10^12 upenumbra today, well under 2^63, but
        // compose both halves to future-proof.
        umBalance += (BigInt(amt.hi) << 64n) + BigInt(amt.lo);
      }
    } finally {
      clearTimeout(timeout);
    }

    const um = Number(umBalance) / 1_000_000;
    cached = { um, fetchedAt: new Date() };
    return um;
  } catch {
    return cached?.um ?? null;
  }
}

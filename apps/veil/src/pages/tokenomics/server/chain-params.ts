'use server';

import { QueryService as AppQueryService } from '@penumbra-zone/protobuf/penumbra/core/app/v1/app_connect';
import { createClient } from '@/shared/utils/protos/utils';

// AppParameters is the chain's authoritative source for issuance mechanics.
// distributions_params.staking_issuance_per_block: upenumbra minted per
//   block and distributed to the active set as staking rewards. FIXED
//   budget — does NOT scale with participation.
// distributions_params.liquidity_tournament_incentive_per_block: upenumbra
//   minted per block and distributed to LP votes each epoch. Also fixed;
//   sunsets at liquidity_tournament_end_block.
// sct_params.epoch_duration: block count per epoch — the cadence at which
//   issuance is paid out.
// Cache 24h — these values only change via a governance proposal, which
// is on the order of days at minimum.

export interface ChainIssuanceParams {
  // upenumbra units (1 UM = 1_000_000 upenumbra)
  stakingIssuancePerBlock: number;
  lqtIssuancePerBlock: number;
  lqtEndBlock: number;
  epochBlocks: number;
  fetchedAt: Date;
}

let cached: ChainIssuanceParams | null = null;
let cachedInflightAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchChainIssuanceParams(): Promise<ChainIssuanceParams | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }
  // Avoid stampede: one in-flight refresh per instance.
  if (now - cachedInflightAt < 5_000) {
    return cached;
  }
  cachedInflightAt = now;

  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  if (!grpcEndpoint) {
    return cached;
  }

  try {
    const client = createClient(grpcEndpoint, AppQueryService);
    // AbortController not wired in @connectrpc/connect via `signal` on the
    // options — Promise.race with a timeout is the portable fallback.
    const res = await Promise.race([
      client.appParameters({}),
      new Promise<never>((_, r) => {
        setTimeout(() => r(new Error('timeout')), 4_000);
      }),
    ]);
    const p = res.appParameters;
    if (!p?.distributionsParams || !p.sctParams) {
      return cached;
    }

    cached = {
      stakingIssuancePerBlock: Number(p.distributionsParams.stakingIssuancePerBlock),
      lqtIssuancePerBlock: Number(p.distributionsParams.liquidityTournamentIncentivePerBlock),
      lqtEndBlock: Number(p.distributionsParams.liquidityTournamentEndBlock),
      epochBlocks: Number(p.sctParams.epochDuration),
      fetchedAt: new Date(),
    };
    return cached;
  } catch {
    // Fail soft — page still renders with observed numbers, just skips
    // the fixed-issuance framing that needs chain params.
    return cached;
  }
}

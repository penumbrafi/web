import { NextRequest, NextResponse } from 'next/server';
import { JsonObject } from '@bufbuild/protobuf';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { ChainRegistryClient } from '@penumbra-labs/registry';
import { serialize, Serialized } from '@/shared/utils/serializer';
import { pindexer } from '@/shared/database';
import { RecentExecutionsResponse, transformData } from './recent-executions';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';

export interface MyExecutionsRequestBody extends JsonObject {
  height: number;
  input: number;
  output: number;
  base: JsonObject;
  quote: JsonObject;
}

/**
 * Returns swap traces array for a given list of pair:height combinations.
 * Needed to merge `latestSwap` method from ViewService with `dex_ex_batch_swap_traces` table from
 * Pindexer and get specific swap time, price, hops information, and more.
 *
 * Parameters:
 * 1. `base` {AssetId}: base asset ID
 * 2. `quote` {AssetId}: quote asset ID
 * 3. `blochHeight` {number}: swap block height
 */
const EMPTY_MY_EXECUTIONS: Serialized<RecentExecutionsResponse> = [];

export const POST = withApiFallback(handlePost, {
  emptyResponse: EMPTY_MY_EXECUTIONS,
  logTag: 'my-executions',
});

async function handlePost(
  req: NextRequest,
): Promise<NextResponse<Serialized<RecentExecutionsResponse>>> {
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!chainId) {
    return NextResponse.json({ error: 'PENUMBRA_CHAIN_ID is not set' }, { status: 500 });
  }

  const registryClient = new ChainRegistryClient();

  const body = (await req.json()) as MyExecutionsRequestBody[];
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const [registry, results] = await withTimeout(
    Promise.all([
      registryClient.remote.get(chainId),
      pindexer.myTrades(
        body.map(swap => ({
          base: AssetId.fromJson(swap.base),
          quote: AssetId.fromJson(swap.quote),
          height: swap.height,
          input: swap.input,
          output: swap.output,
        })),
      ),
    ]),
    DEFAULT_TIMEOUT_MS,
    'my-executions registry+pindexer query',
  );

  const transformed = results
    .map(data => transformData(data, data.type, registry))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json(serialize(transformed));
}

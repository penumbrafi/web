import { NextRequest, NextResponse } from 'next/server';
import { QueryService as GovernanceQueryService } from '@penumbra-zone/protobuf/penumbra/core/component/governance/v1/governance_connect';
import { RateData } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { createClient } from '@/shared/utils/protos/utils';
import { serialize, Serialized } from '@/shared/utils/serializer';

/**
 * Everything the wallet's planner needs to build a governance vote that
 * actually votes.
 *
 * A delegator vote is cast with the delegation notes held at the proposal's
 * START, each valued at its validator's rate at that moment. The planner does
 * NOT look any of this up: it has to be told the start height, the start
 * position in the state commitment tree, and the start-of-proposal rate data.
 * Passing zeros / an empty list finds no notes, or matches none of them, and
 * plans a fee-only transaction that votes nothing. That exact mistake was the
 * voting bug in Zafu's own vote screen (zafu 2c04f543); building the request
 * correctly here is what lets veil vote with the wallet already in the store.
 *
 * Read from pd directly: it is public chain data, so it should not depend on
 * whether the connected wallet chooses to proxy governance queries.
 */
export interface VoteContext {
  proposalId: string;
  startBlockHeight: string;
  startPosition: string;
  rateData: RateData[];
}

export type VoteContextApiResponse = Serialized<VoteContext> | { error: string };

const grpcEndpoint = () =>
  process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ??
  process.env['PENUMBRA_GRPC_ENDPOINT'] ??
  'https://penumbra.rotko.net';

export async function GET(req: NextRequest): Promise<NextResponse<VoteContextApiResponse>> {
  const raw = new URL(req.url).searchParams.get('proposalId') ?? '';
  if (!/^\d+$/.test(raw)) {
    return NextResponse.json({ error: 'proposalId must be a non-negative integer' }, { status: 400 });
  }
  const proposalId = BigInt(raw);

  try {
    const client = createClient(grpcEndpoint(), GovernanceQueryService);
    const data = await client.proposalData({ proposalId });

    const rateData: RateData[] = [];
    for await (const r of client.proposalRateData({ proposalId })) {
      if (r.rateData) {
        rateData.push(r.rateData);
      }
    }

    return NextResponse.json(
      serialize({
        proposalId: proposalId.toString(),
        startBlockHeight: data.startBlockHeight.toString(),
        startPosition: data.startPosition.toString(),
        rateData,
      } satisfies VoteContext),
    );
  } catch (e) {
    // Never degrade to a fake context: a zeroed one is precisely the input
    // that plans a vote-less transaction. Fail loudly instead.
    return NextResponse.json({ error: `could not load proposal ${raw}: ${String(e)}` }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { AssetId, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { PositionId } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { positionIdFromBech32 } from '@penumbra-zone/bech32m/plpid';
import { pnum } from '@penumbrafi/types/pnum';
import { pindexer } from '@/shared/database';
import { serialize } from '@/shared/utils/serializer.ts';
import { PositionsStatsApiResponse, PositionsStatsResponse } from './types';

const MAX_IDS = 200;

export async function GET(req: NextRequest): Promise<NextResponse<PositionsStatsApiResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get('positionIds');

    if (!idsParam) {
      return NextResponse.json({ error: 'Missing required positionIds' }, { status: 400 });
    }

    const ids = idsParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!ids.length) {
      return NextResponse.json(serialize({ items: [] } satisfies PositionsStatsResponse));
    }

    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Too many positionIds; max ${MAX_IDS}` },
        { status: 400 },
      );
    }

    const positionIds = ids.map(id => new PositionId(positionIdFromBech32(id)));
    const rows = await pindexer.getPositionsStats(positionIds);

    const items = rows.map(r => {
      const asset1 = new AssetId({ inner: Uint8Array.from(r.asset_1) });
      const asset2 = new AssetId({ inner: Uint8Array.from(r.asset_2) });
      return {
        positionId: new PositionId({ inner: Uint8Array.from(r.position_id) }),
        asset1,
        asset2,
        openingHeight: r.opening_height,
        openingTime: r.opening_time.toISOString(),
        openingReserves1: new Value({
          assetId: asset1,
          amount: pnum(r.opening_reserves_1).toAmount(),
        }),
        openingReserves2: new Value({
          assetId: asset2,
          amount: pnum(r.opening_reserves_2).toAmount(),
        }),
        fees1: new Value({
          assetId: asset1,
          amount: pnum(r.fees_1).toAmount(),
        }),
        fees2: new Value({
          assetId: asset2,
          amount: pnum(r.fees_2).toAmount(),
        }),
      };
    });

    return NextResponse.json(serialize({ items } satisfies PositionsStatsResponse));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

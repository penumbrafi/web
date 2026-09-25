import { getSeries } from '@/db/queries';
import { jsonError, respond } from '@/lib/http';

export const dynamic = 'force-dynamic';

// A base64 asset id is 32 bytes -> 44 chars ending in '='. Reject anything
// else before it reaches the query (it is bound as a parameter anyway, this
// just keeps junk out of the memo).
const ASSET_ID = /^[A-Za-z0-9+/]{43}=$/;

export const GET = async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const decoded = decodeURIComponent(id);
  if (!ASSET_ID.test(decoded)) {
    return jsonError('bad_request', 'expected a base64 asset id', 400);
  }
  return respond(() => getSeries(decoded));
};

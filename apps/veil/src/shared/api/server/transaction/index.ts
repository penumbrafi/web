import { NextRequest, NextResponse } from 'next/server';
import { pindexer } from '@/shared/database';
import { TransactionApiResponse } from './types';
import { uint8ArrayToHex } from '@penumbra-zone/types/hex';
import {
  withApiFallback,
  withTimeout,
  DEFAULT_TIMEOUT_MS,
} from '@/shared/api/server/with-api-fallback.ts';

// "Not found" (404, real absence) is left alone -- only a thrown error
// (pindexer unreachable/timed out) degrades to this. The `error` string
// is a hint for logs/devtools; the tx inspector page already renders an
// error card for a `{ error }` body regardless of status.
const EMPTY_TRANSACTION: TransactionApiResponse = { error: 'transaction service unavailable' };

export const GET = withApiFallback(handleGet, {
  emptyResponse: EMPTY_TRANSACTION,
  logTag: 'transaction',
});

async function handleGet(
  _req: NextRequest,
  { params }: { params: Promise<{ txHash: string }> },
): Promise<NextResponse<TransactionApiResponse>> {
  const paramsValue = await params;
  const txHash = paramsValue.txHash;
  if (!txHash) {
    return NextResponse.json({ error: 'txHash is required' }, { status: 400 });
  }

  const response = await withTimeout(
    pindexer.getTransaction(txHash),
    DEFAULT_TIMEOUT_MS,
    'transaction pindexer.getTransaction',
  );

  if (!response) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  return NextResponse.json({
    tx: uint8ArrayToHex(response.transaction),
    height: response.height,
  });
}

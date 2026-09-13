import { NextRequest, NextResponse } from 'next/server';

export interface BroadcastApiRequest {
  tx: string;
}

export interface BroadcastApiSuccess {
  hash: string;
  code: number;
  log: string;
  codespace: string;
}

export interface BroadcastApiError {
  error: string;
}

export type BroadcastApiResponse = BroadcastApiSuccess | BroadcastApiError;

interface JsonRpcResult {
  jsonrpc: string;
  id: number;
  result?: { hash?: string; code?: number; log?: string; codespace?: string; data?: string };
  error?: { code: number; message: string; data?: unknown };
}

export async function POST(req: NextRequest): Promise<NextResponse<BroadcastApiResponse>> {
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  if (!grpcEndpoint) {
    return NextResponse.json({ error: 'PENUMBRA_GRPC_ENDPOINT is not set' }, { status: 500 });
  }

  let body: BroadcastApiRequest;
  try {
    body = (await req.json()) as BroadcastApiRequest;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  if (!body.tx || typeof body.tx !== 'string') {
    return NextResponse.json({ error: 'tx (base64) is required' }, { status: 400 });
  }

  // The upstream nginx in front of penumbra.rotko.net proxies `/broadcast_tx_sync`
  // to CometBFT's URI-style handler, which reads `tx` from the query string and
  // ignores any JSON-RPC POST body — sending JSON-RPC gave tendermint an empty tx
  // (hash = SHA256("") = e3b0c442...). Use the URI form with `tx=0x<hex>`.
  const txHex = Buffer.from(body.tx, 'base64').toString('hex');
  const url = new URL('/broadcast_tx_sync', grpcEndpoint);
  url.searchParams.set('tx', `0x${txHex}`);
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { method: 'GET' });
  } catch (e) {
    return NextResponse.json({ error: `upstream fetch failed: ${String(e)}` }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `upstream ${upstream.status}: ${await upstream.text()}` },
      { status: 502 },
    );
  }

  const json = (await upstream.json()) as JsonRpcResult;
  if (json.error) {
    return NextResponse.json(
      { error: `upstream rpc error: ${json.error.message}` },
      { status: 502 },
    );
  }
  const result = json.result;
  if (!result || typeof result.hash !== 'string') {
    return NextResponse.json({ error: 'upstream returned no hash' }, { status: 502 });
  }

  return NextResponse.json({
    hash: result.hash,
    code: result.code ?? 0,
    log: result.log ?? '',
    codespace: result.codespace ?? '',
  });
}

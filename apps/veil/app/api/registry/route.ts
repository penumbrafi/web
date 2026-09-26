// Server-side proxy to the chain-registry. The registry is large
// (~250KB pre-gzip on penumbra-1) and changes rarely, so we want it
// fetched once per hour by Next.js and shared across every visitor;
// the client then caches the result in localStorage on top.
//
// Hoisting the fetch off the root layout's RSC payload removes the
// largest single chunk from every page response — previously every
// page was shipping the entire registry inline as part of the RSC
// stream.
//
// Conditional-GET / ETag:
//   The endpoint stamps every 200 response with a strong ETag
//   ("sha256-<hex>") computed over the JSON body. Clients cache the
//   body alongside the ETag and send `If-None-Match` on subsequent
//   requests; when the registry is unchanged the server replies 304
//   with an empty body (~a couple hundred bytes on the wire) and the
//   client reuses its localStorage copy. When the registry changes
//   the hash changes and clients get a fresh 200 — cache invalidation
//   is automatic within the browser HTTP revalidation interval.
//
//   `Cache-Control: no-cache` (NOT no-store) tells the browser to keep
//   its copy and revalidate on every use rather than serving stale.
//   Revalidation is cheap because of the ETag round-trip.
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { fetchJsonRegistryWithGlobals } from '@/shared/api/fetch-registry';

// Next.js's static-analysis pass requires a literal here, not an
// identifier. Same value as the cache-control max-age below.
export const revalidate = 3600;

const NO_CACHE_HEADERS = {
  // Tell the browser: keep the response, but revalidate every use
  // via If-None-Match. Combined with the ETag this gives us a fast
  // 304 path when the registry is unchanged and immediate visibility
  // of registry bumps otherwise.
  'cache-control': 'no-cache',
} as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // An empty chainId falls back too, not only a missing one: pages Next
  // prerenders at build time (the 404 page) bake in the build's env, which
  // has no PENUMBRA_CHAIN_ID, and ask for `?chainId=`. With `??` that
  // returned 400 and those pages showed "Registry unavailable".
  const chainId = [searchParams.get('chainId'), process.env['PENUMBRA_CHAIN_ID']].find(
    id => !!id,
  );
  if (!chainId) {
    return NextResponse.json(
      { error: 'chainId not specified and PENUMBRA_CHAIN_ID env not set' },
      { status: 400 },
    );
  }

  try {
    const data = await fetchJsonRegistryWithGlobals(chainId);
    // Serialize once so we can hash EXACTLY the bytes we send. Using
    // NextResponse.json here would double-serialize and risk producing
    // different bytes than the ones we hashed.
    const body = JSON.stringify(data);
    const etag = `"sha256-${createHash('sha256').update(body).digest('hex')}"`;

    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          etag,
          ...NO_CACHE_HEADERS,
        },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        etag,
        ...NO_CACHE_HEADERS,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

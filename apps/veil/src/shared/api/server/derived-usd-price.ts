import { NextRequest, NextResponse } from 'next/server';
import { Registry } from '@penumbrafi/registry';
import {
  SimulateTradeRequest,
  SimulateTradeResponse,
  SwapExecution,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { SimulationService } from '@penumbra-zone/protobuf';
import { Client } from '@connectrpc/connect';
import { pnum } from '@penumbra-zone/types/pnum';
import { createClient } from '@/shared/utils/protos/utils';
import { getCachedRegistry } from '@/shared/api/fetch-registry';
import { referencePriceFor } from '@/shared/const/reference-price';

// Derive an asset's USD price via an on-chain route through fixed-USD
// bridge assets (currently only UM). We simulate a $500-notional
// depth-fill in both directions through EVERY configured bridge, gate
// each on depth + spread, then combine the surviving bridges as a
// depth-weighted geometric mean.
//
// Design contract (see the redshiftzero decision doc that produced this):
//  - Bridges are configured as an ordered list. Historically we
//    first-wins'd them; averaging is stronger — a single manipulated
//    bridge is diluted by any healthy peer, and thin bridges get less
//    say in the aggregate. First-in-config order still matters only
//    for the reported `bridge` label when depths tie.
//  - Each bridge must resolve via referencePriceFor() to a
//    `{ kind: 'fixed' }` entry. A typo in the config is a hard 500, not
//    a silent lie — we never make up a stable's USD peg.
//  - Cache 30s. The LP form seeds a whole ladder off this price; 6s is
//    RPC overkill and puts avoidable load on pd.
//  - Manipulation guard: if the fresh aggregate is > 5× or < 0.2× the
//    last cached price AND total surviving depth was below $5k, keep
//    serving the cached price. Cheap sanity, not a substitute for pd's
//    own health.
//
// This module is structured so the pure computation (`attemptBridge`,
// `deriveMultiBridge`) is decoupled from the SimulationService client,
// via an injected `Simulate` callback. Tests can plug in a synthetic
// simulate and exercise all bridge combinations without touching pd.

// Threshold tuning tracks REAL Penumbra depth for UM, not CEX-sized
// markets. As of 2026-09 the UM/USDC.inj book has ~$200 combined
// depth and a ~166% touch spread; the original {500, 1000, 20%}
// numbers refused to serve. These are ship-with-what-actually-trades
// values — retighten as liquidity grows.
//
// NOTIONAL_USD: probe size per side. Any bigger than book depth just
//   fills what's there and returns a slice-VWAP, so oversizing costs
//   nothing but the round trip. Kept modest so a MANIP_MULT breach on
//   a $50 slice is a real signal, not noise from moving one whale.
// DEPTH_MIN_USD: below this combined depth we refuse — a $10 book
//   with a plausible mid is worse than saying "no anchor," because
//   any single tx can move it 5x.
// CROSS_MAX_RATIO: max(buy, sell) / min(buy, sell). Real Penumbra UM
//   trades ~10x wide today; a spoofed one-side book runs 100–1000x
//   apart. 20 catches the spoofs while accepting the honestly-wide
//   illiquid market. (The old diff-over-mid formula is bounded by 2
//   for positive prices, so any ceiling ≥ 2 disables it — useless as
//   a check.)
// MANIP_DEPTH_USD: sticky-cache floor for surprise jumps. A big move
//   with more than this depth is treated as real repricing.
const NOTIONAL_USD = 50;
const DEPTH_MIN_USD = 20;
const CROSS_MAX_RATIO = 20;
const MANIP_MULT = 5;
const MANIP_DEPTH_USD = 200;
const CACHE_TTL_MS = 30_000;
const PD_TIMEOUT_MS = 8_000;

type DerivedResult =
  | { usd: number; bridge: string; depthUsd: number; ageMs: number }
  | { error: string };

export interface CacheEntry {
  at: number;
  usd: number;
  bridge: string;
  depthUsd: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<NextResponse<DerivedResult>>>();

/** Injected simulate callback. Returns the effective aggregate fill in
 *  display units, or null when the book couldn't fill anything. */
export type Simulate = (
  inAssetId: AssetId,
  outAssetId: AssetId,
  inputRaw: bigint,
  inExponent: number,
  outExponent: number,
  signal: AbortSignal,
) => Promise<{ filledInDisp: number; filledOutDisp: number } | null>;

export interface Bridge {
  assetId: AssetId;
  exponent: number;
  symbol: string;
  usd: number;
}

export interface Target {
  assetId: AssetId;
  exponent: number;
  symbol: string;
}

export interface BridgeAttempt {
  usd: number;
  depthUsd: number;
  bridge: string;
}

export type DerivedOutcome =
  | { kind: 'fresh'; usd: number; bridge: string; depthUsd: number }
  | { kind: 'stale'; entry: CacheEntry; reason: 'no-bridge' | 'sticky' }
  | { kind: 'none'; attemptErrors: string[] };

let cachedClient: Client<typeof SimulationService> | undefined;
const getSimClient = (endpoint: string): Client<typeof SimulationService> => {
  if (!cachedClient) {
    cachedClient = createClient(endpoint, SimulationService);
  }
  return cachedClient;
};

const jsonError = (status: number, error: string, headers?: Record<string, string>) =>
  NextResponse.json<DerivedResult>(
    { error },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );

// SimulateTradeResponse.output is a SwapExecution; its `.input` / `.output`
// are aggregate Values (not the traces). We use those aggregates rather
// than post-processing traces — pd already computed them for us.
const aggregateFills = (
  res: SimulateTradeResponse,
): { inputAmt: bigint; outputAmt: bigint } | null => {
  const exec: SwapExecution | undefined = res.output;
  if (!exec?.input?.amount || !exec.output?.amount) {
    return null;
  }
  const inputAmt = pnum(exec.input.amount).toBigInt();
  const outputAmt = pnum(exec.output.amount).toBigInt();
  if (inputAmt === 0n || outputAmt === 0n) {
    return null;
  }
  return { inputAmt, outputAmt };
};

/** Build the default client-backed `Simulate` — production path. */
export const makeClientSimulate =
  (client: Client<typeof SimulationService>): Simulate =>
  async (inAssetId, outAssetId, inputRaw, inExponent, outExponent, signal) => {
    const req = new SimulateTradeRequest({
      input: new Value({ assetId: inAssetId, amount: pnum(inputRaw).toAmount() }),
      output: outAssetId,
    });
    let res: SimulateTradeResponse;
    try {
      res = await client.simulateTrade(req, { signal, timeoutMs: PD_TIMEOUT_MS });
    } catch (e) {
      if (e instanceof Error && e.message.includes('there are no orders to fulfill this swap')) {
        return null;
      }
      throw e;
    }
    const agg = aggregateFills(res);
    if (!agg) {
      return null;
    }
    const filledInDisp = Number(agg.inputAmt) / Math.pow(10, inExponent);
    const filledOutDisp = Number(agg.outputAmt) / Math.pow(10, outExponent);
    if (!Number.isFinite(filledInDisp) || !Number.isFinite(filledOutDisp)) {
      return null;
    }
    if (filledInDisp <= 0 || filledOutDisp <= 0) {
      return null;
    }
    return { filledInDisp, filledOutDisp };
  };

/**
 * Attempt one bridge: simulate a $500-notional depth-fill in both
 * directions, geomean the two VWAPs, and return null if depth or spread
 * gates fail. Pure w.r.t. `simulate` — tests inject their own.
 */
export const attemptBridge = async (
  target: Target,
  bridge: Bridge,
  simulate: Simulate,
  signal: AbortSignal,
): Promise<BridgeAttempt | null> => {
  const notionalBridgeDisp = NOTIONAL_USD / bridge.usd;
  const bridgeAmountRaw = pnum(notionalBridgeDisp, bridge.exponent).toBigInt();

  // BUY: pay bridge → receive target. Effective price bridge/target × peg.
  const buy = await simulate(
    bridge.assetId,
    target.assetId,
    bridgeAmountRaw,
    bridge.exponent,
    target.exponent,
    signal,
  );
  if (!buy) {
    return null;
  }
  const priceBuyUsd = (buy.filledInDisp / buy.filledOutDisp) * bridge.usd;
  const depthBuyUsd = buy.filledInDisp * bridge.usd;

  // SELL: send back the target amount we just received. Same notional
  // in expectation, so the two sides are directly comparable.
  const targetAmountRaw = pnum(buy.filledOutDisp, target.exponent).toBigInt();
  const sell = await simulate(
    target.assetId,
    bridge.assetId,
    targetAmountRaw,
    target.exponent,
    bridge.exponent,
    signal,
  );
  if (!sell) {
    return null;
  }
  const priceSellUsd = (sell.filledOutDisp / sell.filledInDisp) * bridge.usd;
  const depthSellUsd = sell.filledOutDisp * bridge.usd;

  if (priceBuyUsd <= 0 || priceSellUsd <= 0) {
    return null;
  }

  const ratio = Math.max(priceBuyUsd, priceSellUsd) / Math.min(priceBuyUsd, priceSellUsd);
  if (ratio > CROSS_MAX_RATIO) {
    return null;
  }

  const depthUsd = depthBuyUsd + depthSellUsd;
  if (depthUsd < DEPTH_MIN_USD) {
    return null;
  }

  const usd = Math.sqrt(priceBuyUsd * priceSellUsd);
  if (!Number.isFinite(usd) || usd <= 0) {
    return null;
  }

  return { usd, depthUsd, bridge: bridge.symbol };
};

/**
 * Attempt every bridge and combine surviving results as a depth-weighted
 * geometric mean. Applies the manipulation-guard against `cached`.
 * Pure w.r.t. `simulate`.
 */
export const deriveMultiBridge = async (
  target: Target,
  bridges: Bridge[],
  simulate: Simulate,
  cached: CacheEntry | undefined,
  signal: AbortSignal,
): Promise<DerivedOutcome> => {
  const attempts: BridgeAttempt[] = [];
  const attemptErrors: string[] = [];
  for (const bridge of bridges) {
    try {
      const attempt = await attemptBridge(target, bridge, simulate, signal);
      if (attempt) {
        attempts.push(attempt);
      }
    } catch (e) {
      attemptErrors.push(`${bridge.symbol}: ${String(e)}`);
      if (signal.aborted) {
        break;
      }
    }
  }

  if (attempts.length === 0) {
    if (cached) {
      return { kind: 'stale', entry: cached, reason: 'no-bridge' };
    }
    return { kind: 'none', attemptErrors };
  }

  // Depth-weighted geometric mean: exp( Σ wᵢ·ln(usdᵢ) / Σ wᵢ ). One
  // healthy $10k-depth bridge dominates a $1k-depth outlier; one bridge
  // in the list collapses back to that bridge's own value.
  const totalDepth = attempts.reduce((s, a) => s + a.depthUsd, 0);
  let weightedLn = 0;
  for (const a of attempts) {
    weightedLn += (a.depthUsd / totalDepth) * Math.log(a.usd);
  }
  const usd = Math.exp(weightedLn);
  if (!Number.isFinite(usd) || usd <= 0) {
    if (cached) {
      return { kind: 'stale', entry: cached, reason: 'no-bridge' };
    }
    return { kind: 'none', attemptErrors };
  }

  // Reported bridge label: symbol of the deepest, plus a "+N" tag when
  // more than one bridge cleared the gates. Callers wanting the full
  // breakdown can be added later; the LP form just displays it.
  const sorted = [...attempts].sort((a, b) => b.depthUsd - a.depthUsd);
  // non-empty: attempts.length === 0 returned above
  const winnerSym = sorted[0]?.bridge ?? '';
  const bridgeLabel = attempts.length === 1 ? winnerSym : `${winnerSym}+${attempts.length - 1}`;

  if (cached) {
    const ratio = usd / cached.usd;
    if ((ratio > MANIP_MULT || ratio < 1 / MANIP_MULT) && totalDepth < MANIP_DEPTH_USD) {
      return { kind: 'stale', entry: cached, reason: 'sticky' };
    }
  }

  return { kind: 'fresh', usd, bridge: bridgeLabel, depthUsd: totalDepth };
};

const resolveBridges = (registry: Registry, through: string[]): Bridge[] => {
  const allAssets = registry.getAllAssets();
  const resolved: Bridge[] = [];
  for (const sym of through) {
    const src = referencePriceFor(sym);
    // Missing entry is "aspirational bridge, not yet onboarded" — skip
    // and try the next. The `through` list is deliberately allowed to
    // list bridges we plan to add so onboarding a new peg later just
    // starts working without another code edit. Wrong-KIND is the real
    // config bug (someone put a coingecko or onchain-bridge asset in
    // the stable-bridge slot) — that stays a hard error because it
    // would silently poison the geomean with a non-USD anchor.
    if (!src) {
      console.warn(
        `derived-usd-price: bridge "${sym}" has no reference-price entry; skipping. ` +
          `Add it as { kind: "fixed" } in reference-price.ts once its peg is verified.`,
      );
      continue;
    }
    if (src.kind !== 'fixed') {
      throw new Error(
        `derived-usd-price: bridge "${sym}" is kind "${src.kind}" but must be "fixed" — ` +
          `we only bridge through pegged stables so a bridge price is never itself derived`,
      );
    }
    const meta = allAssets.find(a => a.symbol.toLowerCase() === sym.toLowerCase());
    if (!meta) {
      continue;
    }
    const displayDenom = meta.denomUnits.find(d => d.denom === meta.display);
    if (!displayDenom || !meta.penumbraAssetId) {
      continue;
    }
    resolved.push({
      assetId: meta.penumbraAssetId,
      exponent: displayDenom.exponent,
      symbol: meta.symbol,
      usd: src.usd,
    });
  }
  return resolved;
};

const resolveTarget = (
  registry: Registry,
  symbol: string,
): { target: Target; through: string[] } | null => {
  const src = referencePriceFor(symbol);
  if (!src || src.kind !== 'onchain-bridge') {
    return null;
  }
  const allAssets = registry.getAllAssets();
  const meta = allAssets.find(a => a.symbol.toLowerCase() === symbol.toLowerCase());
  if (!meta?.penumbraAssetId) {
    return null;
  }
  const displayDenom = meta.denomUnits.find(d => d.denom === meta.display);
  if (!displayDenom) {
    return null;
  }
  return {
    target: {
      assetId: meta.penumbraAssetId,
      exponent: displayDenom.exponent,
      symbol: meta.symbol,
    },
    through: src.through,
  };
};

const computeDerived = async (
  symbol: string,
  cancel: AbortSignal,
): Promise<NextResponse<DerivedResult>> => {
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!grpcEndpoint || !chainId) {
    return jsonError(500, 'PENUMBRA_GRPC_ENDPOINT or PENUMBRA_CHAIN_ID not set');
  }

  const registry = await getCachedRegistry(chainId);
  const resolved = resolveTarget(registry, symbol);
  if (!resolved) {
    return jsonError(404, `no onchain-bridge entry for symbol "${symbol}"`);
  }
  const bridges = resolveBridges(registry, resolved.through);
  if (bridges.length === 0) {
    return jsonError(404, `no bridges resolvable for "${symbol}" in current registry`);
  }

  const client = getSimClient(grpcEndpoint);
  const timeout = AbortSignal.timeout(PD_TIMEOUT_MS * 2);
  const signal = AbortSignal.any([cancel, timeout]);
  const simulate = makeClientSimulate(client);
  const outcome = await deriveMultiBridge(
    resolved.target,
    bridges,
    simulate,
    cache.get(symbol),
    signal,
  );

  if (outcome.kind === 'stale') {
    const xCache = outcome.reason === 'sticky' ? 'STICKY' : 'STALE-FAIL';
    return NextResponse.json<DerivedResult>(
      {
        usd: outcome.entry.usd,
        bridge: outcome.entry.bridge,
        depthUsd: outcome.entry.depthUsd,
        ageMs: Date.now() - outcome.entry.at,
      },
      { headers: { 'Cache-Control': 'no-store', 'X-Cache': xCache } },
    );
  }
  if (outcome.kind === 'none') {
    const detail = outcome.attemptErrors.length ? ` (${outcome.attemptErrors.join('; ')})` : '';
    return jsonError(404, `no bridge cleared depth/spread gates${detail}`);
  }

  cache.set(symbol, {
    at: Date.now(),
    usd: outcome.usd,
    bridge: outcome.bridge,
    depthUsd: outcome.depthUsd,
  });
  return NextResponse.json<DerivedResult>(
    { usd: outcome.usd, bridge: outcome.bridge, depthUsd: outcome.depthUsd, ageMs: 0 },
    { headers: { 'Cache-Control': 'no-store', 'X-Cache': 'MISS' } },
  );
};

export async function GET(req: NextRequest): Promise<NextResponse<DerivedResult>> {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get('symbol') ?? '').trim();
  if (!raw || !/^[A-Za-z0-9._-]{1,32}$/.test(raw)) {
    return jsonError(400, 'missing or invalid symbol');
  }
  const symbol = raw;
  const now = Date.now();

  const hit = cache.get(symbol);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json<DerivedResult>(
      { usd: hit.usd, bridge: hit.bridge, depthUsd: hit.depthUsd, ageMs: now - hit.at },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': 'HIT',
          'X-Cache-Age-Ms': String(now - hit.at),
        },
      },
    );
  }

  const existing = inflight.get(symbol);
  if (existing) {
    const shared = await existing;
    const headers = new Headers(shared.headers);
    headers.set('X-Cache', 'INFLIGHT');
    return new NextResponse(shared.body ? shared.clone().body : null, {
      status: shared.status,
      headers,
    });
  }

  const p = computeDerived(symbol, req.signal).finally(() => {
    inflight.delete(symbol);
  });
  inflight.set(symbol, p);
  return p;
}

/**
 * Internal helper for other server routes (e.g. /api/um-price) that
 * want the derived USD price without going through HTTP. Returns the
 * fresh or (best-available) cached value, or null when we truly have
 * nothing. Same 30s TTL as the public route.
 */
export const derivedUsdForSymbol = async (
  symbol: string,
  signal: AbortSignal,
): Promise<{ usd: number; bridge: string; depthUsd: number; ageMs: number } | null> => {
  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { usd: hit.usd, bridge: hit.bridge, depthUsd: hit.depthUsd, ageMs: now - hit.at };
  }
  const grpcEndpoint =
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT'];
  const chainId = process.env['PENUMBRA_CHAIN_ID'];
  if (!grpcEndpoint || !chainId) {
    return null;
  }
  const registry = await getCachedRegistry(chainId);
  const resolved = resolveTarget(registry, symbol);
  if (!resolved) {
    return null;
  }
  const bridges = resolveBridges(registry, resolved.through);
  if (bridges.length === 0) {
    return hit ? { ...hit, ageMs: now - hit.at } : null;
  }
  const outcome = await deriveMultiBridge(
    resolved.target,
    bridges,
    makeClientSimulate(getSimClient(grpcEndpoint)),
    hit,
    signal,
  );
  if (outcome.kind === 'stale') {
    return {
      usd: outcome.entry.usd,
      bridge: outcome.entry.bridge,
      depthUsd: outcome.entry.depthUsd,
      ageMs: Date.now() - outcome.entry.at,
    };
  }
  if (outcome.kind === 'none') {
    return hit ? { ...hit, ageMs: now - hit.at } : null;
  }
  cache.set(symbol, {
    at: Date.now(),
    usd: outcome.usd,
    bridge: outcome.bridge,
    depthUsd: outcome.depthUsd,
  });
  return { usd: outcome.usd, bridge: outcome.bridge, depthUsd: outcome.depthUsd, ageMs: 0 };
};

// Test-only: reset the module-scope cache between vitest cases so state
// doesn't leak. NOT for production use.
export const __resetCacheForTests = () => cache.clear();

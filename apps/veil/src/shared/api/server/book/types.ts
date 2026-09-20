import { JsonValue } from '@bufbuild/protobuf';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';

/**
 * Client-side trace. `hops` is the display symbol of each asset along the
 * route (e.g. `['UM', 'USDC']`) — plain strings, NOT protobuf instances.
 *
 * React Query's `structuralSharing` (`replaceEqualDeep`) only dedupes plain
 * objects/arrays. Reconstituting a fresh `ValueView` per hop on every
 * `/api/book` poll gave every row a new `hops[i]` identity each block, so
 * `TradeRow`'s memo (which compares `a.hops[i] !== b.hops[i]`) always missed
 * and every row re-rendered for zero visual change. Strings are structurally
 * shared, so an unchanged book keeps the same `Trace` object identity.
 */
export interface Trace {
  price: string;
  amount: string;
  total: string;
  hops: string[];
}

/**
 * Server-side trace, as built from a pd `SwapExecution_Trace`. Keeps the
 * full `ValueView` per hop because the server indexes traces by asset id
 * (`computeTraceIndex`) and serializes the views onto the wire.
 */
export interface ServerTrace {
  price: string;
  amount: string;
  total: string;
  hops: ValueView[];
}

export type TraceIndex = string;

export interface BuySellTraces {
  buy: Trace[];
  sell: Trace[];
}

export interface BuySellServerTraces {
  buy: ServerTrace[];
  sell: ServerTrace[];
}

export interface RouteBookResponse {
  singleHops: BuySellTraces;
  multiHops: BuySellTraces;
}

export interface TraceJson {
  price: string;
  amount: string;
  total: string;
  hops: JsonValue[];
}

export interface BuySellTracesJson {
  buy: TraceJson[];
  sell: TraceJson[];
}

export interface RouteBookResponseJson {
  singleHops: BuySellTracesJson;
  multiHops: BuySellTracesJson;
}

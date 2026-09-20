import {
  BuySellServerTraces,
  BuySellTraces,
  BuySellTracesJson,
  RouteBookResponse,
  RouteBookResponseJson,
  ServerTrace,
  Trace,
  TraceJson,
} from '@/shared/api/server/book/types.ts';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomFromView, getSymbolFromValueView } from '@penumbra-zone/getters/value-view';

export const serializeTrace = (trace: ServerTrace): TraceJson => {
  return {
    price: trace.price,
    amount: trace.amount,
    total: trace.total,
    hops: trace.hops.map(v => v.toJson()),
  };
};

// The wire envelope still carries the full ValueView JSON per hop (the
// server's SWR cache and any external `/api/book` consumers are unchanged),
// but the client only ever needs the symbol for the hover route display, so
// reduce each hop to a plain string here — at the query boundary — instead
// of minting a fresh protobuf instance per hop per poll. See `Trace`.
const hopSymbol = (v: ValueView): string =>
  getSymbolFromValueView.optional(v) ?? getDisplayDenomFromView.optional(v) ?? 'Unknown';

export const deserializeTrace = (trace: TraceJson): Trace => {
  return {
    price: trace.price,
    amount: trace.amount,
    total: trace.total,
    hops: trace.hops.map(v => hopSymbol(ValueView.fromJson(v))),
  };
};

export const serializeBuySellTraces = (traces: BuySellServerTraces): BuySellTracesJson => {
  return {
    buy: traces.buy.map(serializeTrace),
    sell: traces.sell.map(serializeTrace),
  };
};

export const deserializeBuySellTraces = (traces: BuySellTracesJson): BuySellTraces => {
  return {
    buy: traces.buy.map(deserializeTrace),
    sell: traces.sell.map(deserializeTrace),
  };
};

export const serializeResponse = ({
  singleHops,
  multiHops,
}: {
  singleHops: BuySellServerTraces;
  multiHops: BuySellServerTraces;
}): RouteBookResponseJson => {
  return {
    singleHops: serializeBuySellTraces(singleHops),
    multiHops: serializeBuySellTraces(multiHops),
  };
};

export const deserializeRouteBookResponseJson = ({
  singleHops,
  multiHops,
}: RouteBookResponseJson): RouteBookResponse => {
  return {
    singleHops: deserializeBuySellTraces(singleHops),
    multiHops: deserializeBuySellTraces(multiHops),
  };
};

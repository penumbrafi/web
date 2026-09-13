import { deserialize, Serialized } from './serializer';
import { JsonValue } from '@bufbuild/protobuf';

const parseResponse = async <RES extends object>(response: Response) => {
  const jsonRes = (await response.json()) as Serialized<RES | { error: string }>;

  if (typeof jsonRes === 'object' && 'error' in jsonRes) {
    throw new Error(jsonRes.error);
  }

  if (Array.isArray(jsonRes)) {
    return jsonRes.map(deserialize) as RES;
  }

  return deserialize(jsonRes);
};

/**
 * A wrapper around `fetch` to request data from local endpoints. Features:
 * 1. Composes the URL search params correctly, only provide an object
 * 2. Throws if the response contains an error object
 * 3. Deserializes the response object, if it contains protobuf messages
 */
export const apiFetch = async <RES extends object>(
  url: string,
  searchParams: Record<string, string | number | undefined> = {},
): Promise<RES> => {
  const params = Object.entries(searchParams).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value.toString();
      }
      return acc;
    },
    {},
  );

  const urlParams = new URLSearchParams(params).toString();
  // cache: 'no-store' — every callsite here is one of our own /api/*
  // endpoints that must return fresh data per-block (candles, recent
  // trades, book, summary, pairs). The default browser HTTP cache was
  // pinning stale responses across per-block refetches — the query
  // would refire on every new block but fetch() would return the
  // previously cached body until it expired, making the whole trade
  // page feel frozen. React Query is our cache layer; the HTTP cache
  // must not shadow it.
  const fetchRes = await fetch(`${url}${urlParams && `?${urlParams}`}`, {
    cache: 'no-store',
  });

  return parseResponse<RES>(fetchRes);
};

/**
 * Same as `apiFetch`, but does a POST request with the second param as JSON body.
 */
export const apiPostFetch = async <RES extends object>(
  url: string,
  body: JsonValue = {},
): Promise<RES> => {
  const fetchRes = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  return parseResponse<RES>(fetchRes);
};

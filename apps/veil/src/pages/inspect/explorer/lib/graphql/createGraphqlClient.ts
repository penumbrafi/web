// istanbul ignore file
import { createClient as createWsClient } from 'graphql-ws'
import {
    cacheExchange,
    Client,
    fetchExchange,
    subscriptionExchange,
} from 'urql'

// Singleton client. The original implementation built a fresh urql Client
// (and a fresh GraphQL-WS client) on every call, with `requestPolicy:
// 'network-only'` so the cache exchange did nothing — every container
// re-fetched the same data on every render. With this module-level cache
// keyed by host, identical queries within a request share results, the
// fetch connection is reused, and the WebSocket is opened lazily by urql
// only when something actually subscribes.
let cached: { host: string; client: Client } | null = null

// One dropped connect (undici ConnectTimeoutError / ECONNRESET) used to throw
// out of the whole server render, which the browser shows as React #441 on
// e.g. /explore/proposal/[id]. Retry network-level failures once; GraphQL
// errors come back as a normal response and are not retried.
const fetchWithRetry: typeof fetch = async (input, init) => {
    try {
        return await fetch(input, init)
    } catch (err) {
        if (init?.signal?.aborted) {
            throw err
        }
        await new Promise(resolve => setTimeout(resolve, 250))
        return fetch(input, init)
    }
}

const createGraphqlClient = (): Client => {
    const host = process.env.NEXT_PUBLIC_GRAPHQL_HOST
    if (!host) {
        throw Error('Missing NEXT_PUBLIC_GRAPHQL_HOST')
    }
    if (cached && cached.host === host) {
        return cached.client
    }

    // graphql-ws's createClient lazily connects on first subscribe, so it's
    // OK to instantiate here even for purely-query callers.
    const wsClient = createWsClient({
        url: `wss://${host}/graphql/ws`,
        lazy: true,
    })

    const client = new Client({
        exchanges: [
            cacheExchange,
            fetchExchange,
            subscriptionExchange({
                forwardSubscription: request => {
                    const input = { ...request, query: request.query ?? '' }

                    return {
                        subscribe(sink) {
                            const unsubscribe = wsClient.subscribe(input, sink)
                            return { unsubscribe }
                        },
                    }
                },
            }),
        ],
        fetchOptions: {
            credentials: 'omit',
            signal: AbortSignal.timeout(10000),
        },
        fetch: fetchWithRetry,
        preferGetMethod: false,
        // 'network-only' every request: this client is module-level (cached
        // across the whole Node process), so 'cache-first' + long-lived
        // singleton == every SSR reuses the first response indefinitely —
        // which is how blocks/validators/etc. drifted hours behind the
        // chain tip. urql still deduplicates in-flight identical queries
        // within a single render via its cache exchange, so we keep the
        // per-render dedup while forcing every render to refetch.
        requestPolicy: 'network-only',
        url: `https://${host}/graphql`,
    })

    cached = { host, client }
    return client
}

export default createGraphqlClient

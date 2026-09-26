import { IbcClientService } from '@penumbra-zone/protobuf'
import { ClientState } from '@penumbra-zone/protobuf/ibc/lightclients/tendermint/v1/tendermint_pb'
import { createClient } from '@/shared/utils/protos/utils'

const TTL_MS = 10 * 60_000
const TIMEOUT_MS = 5_000
let cache: { at: number; map: Map<string, string> } | undefined

/**
 * Client id -> counterparty chain id, read from the node's own client
 * states. The hand-kept `ibc` list only knows the clients that existed when
 * it was written, so every client created since (the fresh ones relayers made
 * for the Hub, Osmosis and Celestia) rendered as "Unknown". Server-only;
 * cached for ten minutes; an unreachable node just means no extra names.
 */
export const getClientChainIds = async (): Promise<Map<string, string>> => {
    if (cache && Date.now() - cache.at < TTL_MS) {
        return cache.map
    }
    const endpoint =
        process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT']
    const map = new Map<string, string>()
    if (!endpoint) {
        return map
    }
    try {
        const client = createClient(endpoint, IbcClientService)
        const res = await client.clientStates({}, { timeoutMs: TIMEOUT_MS })
        for (const s of res.clientStates) {
            const any = s.clientState
            if (!any?.value.length || !any.typeUrl.endsWith('tendermint.v1.ClientState')) {
                continue
            }
            const chainId = ClientState.fromBinary(any.value).chainId
            if (chainId) {
                map.set(s.clientId, chainId)
            }
        }
        cache = { at: Date.now(), map }
    } catch (err) {
        console.warn('[ibc] client states unavailable', err)
    }
    return map
}

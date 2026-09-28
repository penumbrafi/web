import { IbcClientService } from '@penumbra-zone/protobuf'
import { ClientState } from '@penumbra-zone/protobuf/ibc/lightclients/tendermint/v1/tendermint_pb'
import { createClient } from '@/shared/utils/protos/utils'

const TTL_MS = 10 * 60_000
const TIMEOUT_MS = 5_000

export interface IbcClientInfo {
    /** Counterparty chain id, from the tendermint client state. */
    chainId?: string
    /**
     * Trusting period in milliseconds: how long after its last update a client
     * keeps accepting proofs. `clientExpiresAt` adds it to the client's last
     * activity to show when the channel goes dark.
     */
    trustingPeriodMs?: number
}

let cache: { at: number; map: Map<string, IbcClientInfo> } | undefined

/**
 * Client id -> info read from the node's own client states. The hand-kept
 * `ibc` list only knows the clients that existed when it was written, so every
 * client created since (the fresh ones relayers made for the Hub, Osmosis and
 * Celestia) would render as "Unknown" without the chain id; the trusting
 * period is what turns "this client was last updated at T" into an expiry
 * estimate. Server-only; cached for ten minutes; an unreachable node just
 * means no extra names and no expiry estimates.
 */
export const getClientStates = async (): Promise<Map<string, IbcClientInfo>> => {
    if (cache && Date.now() - cache.at < TTL_MS) {
        return cache.map
    }
    const endpoint =
        process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ?? process.env['PENUMBRA_GRPC_ENDPOINT']
    const map = new Map<string, IbcClientInfo>()
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
            const state = ClientState.fromBinary(any.value)
            const trustingPeriod = state.trustingPeriod
            map.set(s.clientId, {
                chainId: state.chainId || undefined,
                trustingPeriodMs: trustingPeriod
                    ? Number(trustingPeriod.seconds) * 1000 + trustingPeriod.nanos / 1e6
                    : undefined,
            })
        }
        cache = { at: Date.now(), map }
    } catch (err) {
        console.warn('[ibc] client states unavailable', err)
    }
    return map
}

import { ClientStatus } from '@/pages/inspect/explorer/lib/graphql/generated/types'

/**
 * `?filter=` values for the IBC clients table, in tab order. `open` is the
 * default view: on Penumbra the handful of live clients are buried under
 * dozens of expired ones, so dead channels get their own tab instead of the
 * landing view.
 */
export const CLIENT_FILTERS = ['open', 'expired', 'frozen', 'all'] as const

export type ClientFilter = (typeof CLIENT_FILTERS)[number]

/** Client status each tab lists; `all` lists every client. */
export const FILTER_STATUS: Record<ClientFilter, ClientStatus | undefined> = {
    open: ClientStatus.Active,
    expired: ClientStatus.Expired,
    frozen: ClientStatus.Frozen,
    all: undefined,
}

export const isClientFilter = (value: string | undefined): value is ClientFilter =>
    value !== undefined && (CLIENT_FILTERS as readonly string[]).includes(value)

/**
 * When a channel goes dark: a light client stops accepting proofs once its
 * trusting period has elapsed since the last time it was updated.
 *
 * The node never prunes consensus states, so the authoritative last-update
 * time is not something a page can ask for — `ConsensusStates` for a busy
 * client is tens of thousands of entries and tens of seconds per call. The
 * client's last indexed IBC transaction is used instead: measured against the
 * consensus states themselves it lands within an hour of the real update on
 * every live client, against a trusting period of days.
 */
export const clientExpiresAt = (
    status: ClientStatus,
    timestamp: number,
    trustingPeriodMs: number | undefined
): number | undefined => {
    // A frozen client never expires: governance froze it, and only unfreezing
    // changes that. No trusting period or no activity means no estimate.
    if (
        status === ClientStatus.Frozen ||
        trustingPeriodMs === undefined ||
        !Number.isFinite(timestamp)
    ) {
        return undefined
    }

    return timestamp + trustingPeriodMs
}

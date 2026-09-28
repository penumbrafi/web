import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    IbcStatsQuery,
    IbcStatsQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { ibcStatsQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { TransformedIbcStats } from '@/pages/inspect/explorer/lib/types'
import { clientExpiresAt } from '@/pages/inspect/explorer/lib/ibc/client-health'
import { getClientStates } from '@/pages/inspect/explorer/lib/ibc/client-states'

const getIbcStats = async (args?: {
    clientId?: string
}): Promise<TransformedIbcStats[] | undefined> => {
    const graphqlClient = createGraphqlClient()

    const [result, states] = await Promise.all([
        graphqlClient
            .query<IbcStatsQuery, IbcStatsQueryVariables>(ibcStatsQuery, {
                ...args,
            })
            .toPromise(),
        getClientStates(),
    ])

    if (result.error) {
        throw result.error
    }

    return result.data?.ibcStats.map(stats => {
        const { lastUpdated, ...props } = stats
        const timestamp = dayjs(lastUpdated).valueOf()
        const state = states.get(props.id)

        return {
            ...props,
            timestamp,
            counterpartyChainId: state?.chainId,
            expiresAt: clientExpiresAt(props.status, timestamp, state?.trustingPeriodMs),
        }
    })
}

export default getIbcStats

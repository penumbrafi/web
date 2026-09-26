import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    IbcStatsQuery,
    IbcStatsQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { ibcStatsQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { TransformedIbcStats } from '@/pages/inspect/explorer/lib/types'
import { getClientChainIds } from '@/pages/inspect/explorer/lib/ibc/client-chains'

const getIbcStats = async (args?: {
    clientId?: string
}): Promise<TransformedIbcStats[] | undefined> => {
    const graphqlClient = createGraphqlClient()

    const [result, chainIds] = await Promise.all([
        graphqlClient
            .query<IbcStatsQuery, IbcStatsQueryVariables>(ibcStatsQuery, {
                ...args,
            })
            .toPromise(),
        getClientChainIds(),
    ])

    if (result.error) {
        throw result.error
    }

    return result.data?.ibcStats.map(stats => {
        const { lastUpdated, ...props } = stats

        return {
            ...props,
            timestamp: dayjs(lastUpdated).valueOf(),
            counterpartyChainId: chainIds.get(props.id),
        }
    })
}

export default getIbcStats

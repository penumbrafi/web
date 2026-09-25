import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    IbcFlowHistoryQuery,
    IbcFlowHistoryQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { ibcFlowHistoryQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { nonEmpty } from '@/pages/inspect/explorer/lib/utils'

const getIbcFlowHistory = async (
    clientId?: string,
    days?: number
): Promise<IbcFlowHistoryQuery['ibcFlowHistory']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<IbcFlowHistoryQuery, IbcFlowHistoryQueryVariables>(
            ibcFlowHistoryQuery,
            {
                clientId: nonEmpty(clientId) ?? null,
                days: days ?? null,
            }
        )
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.ibcFlowHistory ?? []
}

export default getIbcFlowHistory

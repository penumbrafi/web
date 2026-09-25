import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    SwapVolumeHistoryQuery,
    SwapVolumeHistoryQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { swapVolumeHistoryQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getSwapVolumeHistory = async (
    days?: number
): Promise<SwapVolumeHistoryQuery['swapVolumeHistory']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            SwapVolumeHistoryQuery,
            SwapVolumeHistoryQueryVariables
        >(swapVolumeHistoryQuery, { days: days ?? null })
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.swapVolumeHistory ?? []
}

export default getSwapVolumeHistory

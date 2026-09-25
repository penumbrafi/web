import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    RecentSwapPricesQuery,
    RecentSwapPricesQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { recentSwapPricesQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getRecentSwapPrices = async (
    limit?: number
): Promise<RecentSwapPricesQuery['recentSwapPrices']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            RecentSwapPricesQuery,
            RecentSwapPricesQueryVariables
        >(recentSwapPricesQuery, { limit: limit ?? null })
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.recentSwapPrices ?? []
}

export default getRecentSwapPrices

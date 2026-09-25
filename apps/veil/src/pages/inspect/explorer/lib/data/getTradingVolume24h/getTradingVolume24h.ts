import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    TradingVolume24hQuery,
    TradingVolume24hQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { tradingVolume24hQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getTradingVolume24h = async (
    limit?: number
): Promise<TradingVolume24hQuery['tradingVolume24h']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            TradingVolume24hQuery,
            TradingVolume24hQueryVariables
        >(tradingVolume24hQuery, { limit: limit ?? null })
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.tradingVolume24h ?? []
}

export default getTradingVolume24h

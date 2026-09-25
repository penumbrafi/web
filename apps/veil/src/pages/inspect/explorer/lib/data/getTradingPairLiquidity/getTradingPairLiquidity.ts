import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    TradingPairLiquidityQuery,
    TradingPairLiquidityQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { tradingPairLiquidityQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getTradingPairLiquidity = async (
    limit?: number
): Promise<TradingPairLiquidityQuery['tradingPairLiquidity']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            TradingPairLiquidityQuery,
            TradingPairLiquidityQueryVariables
        >(tradingPairLiquidityQuery, { limit: limit ?? null })
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.tradingPairLiquidity ?? []
}

export default getTradingPairLiquidity

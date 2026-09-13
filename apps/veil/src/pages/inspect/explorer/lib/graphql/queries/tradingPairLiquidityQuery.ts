// Auto-migrated from tradingPairLiquidityQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query TradingPairLiquidity($limit: Int) {
    tradingPairLiquidity(limit: $limit) {
        tradingPairAsset1
        tradingPairAsset2
        activePositions
        totalReserves1
        totalReserves2
        avgFeePercentage
    }
}

`;

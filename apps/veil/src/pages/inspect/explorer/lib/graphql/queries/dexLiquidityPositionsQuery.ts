// Auto-migrated from dexLiquidityPositionsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query DexLiquidityPositions($limit: CollectionLimit!, $filter: LiquidityPositionFilter) {
    liquidityPositions(limit: $limit, filter: $filter) {
        items {
            tradingPairAsset1
            tradingPairAsset2
            reserves1Amount
            reserves2Amount
            state
            feePercentage
            updatedAt
            positionId
        }
        total
    }
}

`;

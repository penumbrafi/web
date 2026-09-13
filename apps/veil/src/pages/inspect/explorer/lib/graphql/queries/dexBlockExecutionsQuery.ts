// Auto-migrated from dexBlockExecutionsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query DexBlockExecutions($filter: SwapExecutionFilter) {
    latestExecutions(filter: $filter) {
        blockHeight
        timestamp
        batchSwaps {
            id
            executionType
            totalInputAssetId
            totalInputAmount
            totalOutputAssetId
            totalOutputAmount
            individualSwaps {
                routeSteps {
                    assetId
                    amount
                }
            }
        }
    }
}

`;

// Auto-migrated from recentSwapPricesQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query RecentSwapPrices($limit: Int) {
    recentSwapPrices(limit: $limit) {
        inputAssetId
        outputAssetId
        avgPrice
        swapCount
        latestSwap
    }
}

`;

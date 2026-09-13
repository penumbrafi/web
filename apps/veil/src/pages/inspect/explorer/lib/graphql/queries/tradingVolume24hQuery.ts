// Auto-migrated from tradingVolume24hQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query TradingVolume24h($limit: Int) {
    tradingVolume24h(limit: $limit) {
        assetId
        volume24h
        swapCount24h
        periodStart
        periodEnd
    }
}

`;

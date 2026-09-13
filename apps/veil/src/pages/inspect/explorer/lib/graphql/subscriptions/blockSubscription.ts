// Auto-migrated from blockSubscription.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
subscription BlockUpdate {
    latestBlocks(limit: 1) {
        height
        createdAt
        transactionsCount
    }
}

`;

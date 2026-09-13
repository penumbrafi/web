// Auto-migrated from pastProposalsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query PastProposals($limit: CollectionLimit!) {
    pastProposals(limit: $limit) {
        items {
            endBlockHeight
            endTimestamp
            id
            kind
            outcome
            state
            title
            totalVotes
        }
        total
    }
}

`;

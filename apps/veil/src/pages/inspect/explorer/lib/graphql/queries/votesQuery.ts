// Auto-migrated from votesQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Votes($proposalId: Int!, $limit: CollectionLimit!) {
    proposalDetail(id: $proposalId) {
        votes(limit: $limit) {
            items {
                effectiveVotingPower
                id
                name
                txHash
                vote
                votedAt
                votingPowerPercentage
            }
            total
        }
    }
}

`;

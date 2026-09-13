// Auto-migrated from votingStartQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query VotingStart($proposalId: Int!) {
    proposalDetail(id: $proposalId) {
        votingStartedBlockHeight
        votingStartedTimestamp
    }
}

`;

// Auto-migrated from votingEndQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query VotingEnd($proposalId: Int!) {
    proposalDetail(id: $proposalId) {
        state
        votingEndedBlockHeight
        votingEndedTimestamp
    }
}

`;

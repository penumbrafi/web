// Auto-migrated from votingQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Voting($proposalId: Int!) {
    proposalDetail(id: $proposalId) {
        abstainVotes
        abstainVotesPercentage
        noVotes
        noVotesPercentage
        outcome
        quorum
        state
        totalVotes
        yesVotes
        yesVotesPercentage
    }
}

`;

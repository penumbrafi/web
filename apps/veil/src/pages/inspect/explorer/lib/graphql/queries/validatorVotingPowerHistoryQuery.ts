// Auto-migrated from validatorVotingPowerHistoryQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorVotingPowerHistory(
    $validatorId: String!,
    $startTime: DateTime,
    $endTime: DateTime,
    $limit: Int
) {
    validatorVotingPowerHistory(
        validatorId: $validatorId,
        startTime: $startTime,
        endTime: $endTime,
        limit: $limit
    ) {
        validatorIdentityKey
        votingPower
        blockHeight
        timestamp
    }
}

`;

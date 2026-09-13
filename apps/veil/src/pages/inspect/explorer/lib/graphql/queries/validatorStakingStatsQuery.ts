// Auto-migrated from validatorStakingStatsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorStakingStats($validatorId: String!) {
    validatorStakingStats(validatorId: $validatorId) {
        validatorIdentityKey
        totalDelegations
        totalUndelegations
        pendingUndelegations
        pendingUndelegateCount
        nextReleaseHeight
    }
}

`;

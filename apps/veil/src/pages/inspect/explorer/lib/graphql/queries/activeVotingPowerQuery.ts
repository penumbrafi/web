// Auto-migrated from activeVotingPowerQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ActiveVotingPower($filter: ValidatorFilter) {
    validatorsHomepage(filter: $filter) {
        stakingParameters {
            totalStaked
        }
    }
}

`;

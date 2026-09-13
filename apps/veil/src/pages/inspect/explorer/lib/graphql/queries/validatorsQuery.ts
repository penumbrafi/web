// Auto-migrated from validatorsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Validators($filter: ValidatorFilter) {
    validatorsHomepage(filter: $filter) {
        validators {
            id
            name
            state
            bondingState
            votingPower
            votingPowerActivePercentage
            uptime
            firstSeenTime
            commission
        }
    }
}

`;

// Auto-migrated from validatorParametersQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorParameters {
    validatorsHomepage {
        stakingParameters {
            uptimeBlocksWindow
            uptimeMinRequired
            slashingPenaltyDowntime
            slashingPenaltyMisbehavior
            unbondingDelay
        }
    }
}

`;

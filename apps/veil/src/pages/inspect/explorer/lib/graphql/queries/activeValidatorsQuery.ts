// Auto-migrated from activeValidatorsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ActiveValidators {
    validatorsHomepage {
        stakingParameters {
            activeValidatorCount
            activeValidatorLimit
        }
    }
}

`;

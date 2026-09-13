// Auto-migrated from govParametersQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query GovParameters {
    governanceParameters {
        depositAmount
        passingThreshold
        proposalDuration
        slashingThreshold
        validQuorum
    }
}

`;

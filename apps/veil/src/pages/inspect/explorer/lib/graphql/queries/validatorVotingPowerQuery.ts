// Auto-migrated from validatorVotingPowerQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorVotingPower($id: String!) {
    validatorDetails(id: $id) {
        state
        votingPower
    }
}

`;

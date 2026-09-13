// Auto-migrated from validatorVotingPercentageQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorVotingPercentage($id: String!) {
    validatorDetails(id: $id) {
       votingPowerActivePercentage
    }
}

`;

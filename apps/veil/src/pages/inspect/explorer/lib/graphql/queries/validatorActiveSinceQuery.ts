// Auto-migrated from validatorActiveSinceQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorActiveSince($id: String!) {
    validatorDetails(id: $id) {
       activeSince
    }
}

`;

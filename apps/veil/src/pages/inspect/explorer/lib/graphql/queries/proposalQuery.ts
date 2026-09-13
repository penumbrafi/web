// Auto-migrated from proposalQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Proposal($id: Int!) {
    proposalDetail(id: $id) {
        depositAmount
        description
        id
        kind
        outcome
        payload
        state
        title
    }
}

`;

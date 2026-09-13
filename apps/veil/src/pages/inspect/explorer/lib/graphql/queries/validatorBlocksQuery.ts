// Auto-migrated from validatorBlocksQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorBlocks($id: String!) {
    validatorDetails(id: $id) {
        state
        last300Blocks {
            height
            signed
        }
    }
}

`;

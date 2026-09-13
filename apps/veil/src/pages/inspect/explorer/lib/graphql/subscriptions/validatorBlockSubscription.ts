// Auto-migrated from validatorBlockSubscription.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
subscription ValidatorBlockUpdate($id: String!) {
    validatorBlocks(validatorId: $id) {
        blockHeight
        signed
    }
}

`;

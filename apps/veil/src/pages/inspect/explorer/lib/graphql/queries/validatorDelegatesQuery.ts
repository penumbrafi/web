// Auto-migrated from validatorDelegatesQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorDelegates(
    $validatorId: String!,
    $limit: Int,
    $offset: Int
) {
    validatorDelegates(
        validatorId: $validatorId,
        limit: $limit,
        offset: $offset
    ) {
        id
        txHash
        validatorIdentityKey
        delegationAmount
        unbondedAmount
        epochIndex
        blockHeight
        timestamp
    }
}

`;

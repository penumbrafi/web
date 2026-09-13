// Auto-migrated from validatorUndelegatesQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ValidatorUndelegates(
    $validatorId: String!,
    $limit: Int,
    $offset: Int,
    $pendingOnly: Boolean
) {
    validatorUndelegates(
        validatorId: $validatorId,
        limit: $limit,
        offset: $offset,
        pendingOnly: $pendingOnly
    ) {
        id
        txHash
        validatorIdentityKey
        delegationAmount
        unbondedAmount
        epochIndex
        unbondingStartHeight
        releaseHeight
        blockHeight
        timestamp
        claimed
    }
}

`;

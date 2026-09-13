// Auto-migrated from partialTransactionFragment.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
fragment PartialTransaction on Transaction {
    hash
    block {
        height
        createdAt
    }
    ibcStatus
    raw
}

`;

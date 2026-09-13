// Auto-migrated from transactionFragment.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
fragment Transaction on Transaction {
    hash
    block {
        height
        createdAt
    }
    body {
        parameters {
            chainId
            fee {
                amount
            }
        }
    }
    raw
    rawJson
}

`;

// Auto-migrated from transactionSubscription.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
subscription TransactionUpdate {
    latestTransactions(limit: 1) {
        hash
        id
        raw
    }
}

`;

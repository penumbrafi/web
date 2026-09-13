// Auto-migrated from transactionsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';
import partialTransactionFragment from '../fragments/partialTransactionFragment';

export default gql`
    query Transactions($limit: CollectionLimit!, $filter: TransactionFilter) {
        transactions(limit: $limit, filter: $filter) {
            items {
                ...PartialTransaction
            }
            total
        }
    }

    ${partialTransactionFragment}
`;

// Auto-migrated from transactionQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';
import transactionFragment from '../fragments/transactionFragment';

export default gql`
    query Transaction($hash: String!) {
        transaction(hash: $hash) {
            ...Transaction
        }
    }

    ${transactionFragment}
`;

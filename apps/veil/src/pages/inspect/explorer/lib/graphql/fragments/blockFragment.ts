// Auto-migrated from blockFragment.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';
import partialTransactionFragment from './partialTransactionFragment';

export default gql`
    fragment Block on Block {
        height
        createdAt
        transactions {
            ...PartialTransaction
        }
        rawJson
    }

    ${partialTransactionFragment}
`;

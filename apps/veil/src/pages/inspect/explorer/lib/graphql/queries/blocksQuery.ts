// Auto-migrated from blocksQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';
import partialBlockFragment from '../fragments/partialBlockFragment';

export default gql`
    query Blocks($limit: CollectionLimit!, $filter: BlockFilter) {
        blocks(limit: $limit, filter: $filter) {
            items {
                ...PartialBlock
            }
            total
        }
    }

    ${partialBlockFragment}
`;

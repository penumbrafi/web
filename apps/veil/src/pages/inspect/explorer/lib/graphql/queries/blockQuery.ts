// Auto-migrated from blockQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';
import blockFragment from '../fragments/blockFragment';

export default gql`
    query Block($height: Int!) {
        block(height: $height) {
            ...Block
        }
    }

    ${blockFragment}
`;

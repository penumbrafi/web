// Auto-migrated from searchQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Search($slug: String!) {
    search(slug: $slug) {
        __typename
        ... on Block {
            height
        }
        ... on Transaction {
            hash
        }
        ... on ValidatorSearchResults {
            items {
                id
                displayName
            }
        }
    }
}

`;

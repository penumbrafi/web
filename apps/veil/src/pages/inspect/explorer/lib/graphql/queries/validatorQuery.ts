// Auto-migrated from validatorQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query Validator($id: String!) {
    validatorDetails(id: $id) {
        id
        name
        state
        bondingState
        website
        description
        totalUptime
        uptimeBlockWindow
        signedBlocks
        missedBlocks
        commissionPercentage
        commissionStreams {
            recipientAddress
            streamType
            rateBps
        }
    }
}

`;

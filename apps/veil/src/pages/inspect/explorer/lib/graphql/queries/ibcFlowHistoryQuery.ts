// Auto-migrated from ibcFlowHistoryQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query IbcFlowHistory($clientId: String, $days: Int) {
    ibcFlowHistory(clientId: $clientId, days: $days) {
        date
        inflowVolume
        outflowVolume
        inflowCount
        outflowCount
    }
}

`;

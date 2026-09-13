// Auto-migrated from ibcStatsQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query IbcStats($clientId: String) {
    ibcStats(clientId: $clientId) {
        id: clientId
        status
        channelId
        counterpartyChannelId
        lastUpdated
        shieldedVolume
        shieldedTxCount
        unshieldedVolume
        unshieldedTxCount
        totalTxCount
        pendingTxCount
        expiredTxCount
    }
}

`;

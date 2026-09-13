// Auto-migrated from swapVolumeHistoryQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query SwapVolumeHistory($days: Int) {
    swapVolumeHistory(days: $days) {
        date
        totalVolume
        swapCount
        arbCount
        organicCount
    }
}

`;

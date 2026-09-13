// Auto-migrated from chainParametersSubscription.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
subscription ChainParametersUpdate {
    chainParameters {
        chainId
        currentBlockTime
        currentBlockHeight
        currentEpoch
        epochDuration
        nextEpochIn
    }
}

`;

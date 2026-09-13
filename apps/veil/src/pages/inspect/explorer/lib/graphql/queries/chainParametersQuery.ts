// Auto-migrated from chainParametersQuery.graphql for Next 16 / Turbopack ESM.
import { gql } from 'graphql-tag';

export default gql`
query ChainParameters {
    validatorsHomepage {
        chainParameters {
            chainId
            currentBlockTime
            currentBlockHeight
            currentEpoch
            epochDuration
            nextEpochIn
        }
    }
}

`;

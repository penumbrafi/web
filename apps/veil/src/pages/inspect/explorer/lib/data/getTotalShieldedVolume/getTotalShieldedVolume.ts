import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    TotalShieldedVolumeQuery,
    TotalShieldedVolumeQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { totalShieldedVolumeQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getTotalShieldedVolume = async (): Promise<number | undefined> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            TotalShieldedVolumeQuery,
            TotalShieldedVolumeQueryVariables
        >(totalShieldedVolumeQuery, {})
        .toPromise()

    if (result.error) {
        throw result.error
    }

    if (typeof result.data?.ibcTotalShieldedVolume.value === 'string') {
        return Number(result.data.ibcTotalShieldedVolume.value)
    }
    return undefined
}

export default getTotalShieldedVolume

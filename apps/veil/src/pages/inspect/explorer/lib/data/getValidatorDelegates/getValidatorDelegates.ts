import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    ValidatorDelegatesQuery,
    ValidatorDelegatesQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { validatorDelegatesQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getValidatorDelegates = async (
    validatorId: string,
    limit?: number,
    offset?: number
): Promise<ValidatorDelegatesQuery['validatorDelegates']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<ValidatorDelegatesQuery, ValidatorDelegatesQueryVariables>(
            validatorDelegatesQuery,
            {
                limit: limit ?? null,
                offset: offset ?? null,
                validatorId,
            }
        )
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.validatorDelegates ?? []
}

export default getValidatorDelegates

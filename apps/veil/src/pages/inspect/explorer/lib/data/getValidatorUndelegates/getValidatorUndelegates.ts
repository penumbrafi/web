import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    ValidatorUndelegatesQuery,
    ValidatorUndelegatesQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { validatorUndelegatesQuery } from '@/pages/inspect/explorer/lib/graphql/queries'

const getValidatorUndelegates = async (
    validatorId: string,
    limit?: number,
    offset?: number,
    pendingOnly?: boolean
): Promise<ValidatorUndelegatesQuery['validatorUndelegates']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<ValidatorUndelegatesQuery, ValidatorUndelegatesQueryVariables>(
            validatorUndelegatesQuery,
            {
                limit: limit ?? null,
                offset: offset ?? null,
                pendingOnly: pendingOnly ? true : null,
                validatorId,
            }
        )
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.validatorUndelegates ?? []
}

export default getValidatorUndelegates

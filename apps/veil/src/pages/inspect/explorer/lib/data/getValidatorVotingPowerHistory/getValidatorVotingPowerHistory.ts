import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    ValidatorVotingPowerHistoryQuery,
    ValidatorVotingPowerHistoryQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { validatorVotingPowerHistoryQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { nonEmpty } from '@/pages/inspect/explorer/lib/utils'

const getValidatorVotingPowerHistory = async (
    validatorId: string,
    startTime?: string,
    endTime?: string,
    limit?: number
): Promise<ValidatorVotingPowerHistoryQuery['validatorVotingPowerHistory']> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            ValidatorVotingPowerHistoryQuery,
            ValidatorVotingPowerHistoryQueryVariables
        >(validatorVotingPowerHistoryQuery, {
            endTime: nonEmpty(endTime) ?? null,
            limit: limit ?? null,
            startTime: nonEmpty(startTime) ?? null,
            validatorId,
        })
        .toPromise()

    if (result.error) {
        throw result.error
    }

    return result.data?.validatorVotingPowerHistory ?? []
}

export default getValidatorVotingPowerHistory

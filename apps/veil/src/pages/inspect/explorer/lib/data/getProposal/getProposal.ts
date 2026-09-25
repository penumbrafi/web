import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    ProposalQuery,
    ProposalQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { proposalQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { TransformedProposal } from '@/pages/inspect/explorer/lib/types'
import { transformProposalKind } from '@/pages/inspect/explorer/lib/utils'
import { asRecord } from '@/pages/inspect/explorer/lib/utils/json'

const getProposal = async (
    id: number
): Promise<TransformedProposal | undefined> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<ProposalQuery, ProposalQueryVariables>(proposalQuery, { id })
        .toPromise()

    if (result.error) {
        throw result.error
    } else if (!result.data?.proposalDetail) {
        return
    }

    const { kind, payload, ...proposal } = result.data.proposalDetail

    const {
        description: payloadDescription,
        id: payloadId,
        title: payloadTitle,
        ...remainingPayload
    } = asRecord(payload)

    return {
        ...proposal,
        kind: transformProposalKind(kind),
        rawJson: {
            id: payloadId,
            title: payloadTitle,
            description: payloadDescription,
            ...remainingPayload,
        },
    }
}

export default getProposal

import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    CollectionLimit,
    VotesQuery,
    VotesQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { votesQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { TransformedVote } from '@/pages/inspect/explorer/lib/types'

const getVotes = async (
    proposalId: number,
    limit: CollectionLimit
): Promise<{ total: number; votes: TransformedVote[] }> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            VotesQuery,
            VotesQueryVariables
        >(votesQuery, { limit, proposalId })
        .toPromise()

    if (result.error) {
        throw result.error
    } else if (!result.data?.proposalDetail) {
        return { total: 0, votes: [] }
    }

    // The schema allows a vote without a tx hash or value; such a row has
    // nothing to link or show, so it is skipped rather than crashing the table.
    const votes = result.data.proposalDetail.votes.items.flatMap(vote =>
        vote.txHash && vote.vote
            ? [
                  {
                      id: vote.id,
                      name: vote.name,
                      power: Number(vote.effectiveVotingPower),
                      powerPercentage: Number(vote.votingPowerPercentage),
                      timestamp: dayjs(vote.votedAt).valueOf(),
                      transactionHash: vote.txHash,
                      value: vote.vote,
                  },
              ]
            : []
    )

    return { total: result.data.proposalDetail.votes.total, votes }
}

export default getVotes

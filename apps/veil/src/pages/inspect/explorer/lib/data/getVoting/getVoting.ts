import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import {
    ProposalOutcome,
    ProposalState,
    VotingQuery,
    VotingQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { votingQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { TransformedVoting, VotingState } from '@/pages/inspect/explorer/lib/types'
import { getChainQuorum } from './chainQuorum'

const getVoting = async (
    proposalId: number
): Promise<TransformedVoting | undefined> => {
    const graphqlClient = createGraphqlClient()

    const [result, chainQuorum] = await Promise.all([
        graphqlClient
            .query<VotingQuery, VotingQueryVariables>(votingQuery, {
                proposalId,
            })
            .toPromise(),
        getChainQuorum(proposalId),
    ])

    if (result.error) {
        throw result.error
    } else if (!result.data?.proposalDetail) {
        return
    }

    let state: undefined | VotingState

    if (result.data.proposalDetail.state === ProposalState.Voting) {
        state = VotingState.InProgress
    } else {
        switch (result.data.proposalDetail.outcome) {
            case ProposalOutcome.Passed:
                state = VotingState.Passed
                break
            case ProposalOutcome.Failed:
                state = VotingState.Failed
                break
            case ProposalOutcome.Slashed:
                state = VotingState.Slashed
                break
        }
    }

    return {
        abstain: Number(result.data.proposalDetail.abstainVotes),
        abstainPercentage: Number(
            result.data.proposalDetail.abstainVotesPercentage
        ),
        no: Number(result.data.proposalDetail.noVotes),
        noPercentage: Number(result.data.proposalDetail.noVotesPercentage),
        // The indexer's quorum is computed over every validator it knows,
        // not the active set pd counts; see chainQuorum.ts.
        quorum: chainQuorum ?? Number(result.data.proposalDetail.quorum),
        state,
        total: Number(result.data.proposalDetail.totalVotes),
        yes: Number(result.data.proposalDetail.yesVotes),
        yesPercentage: Number(result.data.proposalDetail.yesVotesPercentage),
    }
}

export default getVoting

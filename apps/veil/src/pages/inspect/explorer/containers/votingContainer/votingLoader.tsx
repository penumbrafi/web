// istanbul ignore file
import { FC } from 'react'
import { Surface, VotingStatePill } from '@/pages/inspect/explorer/components'
import { getVoting } from '@/pages/inspect/explorer/lib/data'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import type { Props } from './votingContainer'
import VotingNumbers from './votingNumbers'

const VotingLoader: FC<Props> = async ({ proposalId, ...props }) => {
    const voting = await getVoting(proposalId)

    if (!voting) {
        return
    }

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-4 p-6', props.className)}
        >
            <VotingStatePill state={voting.state} />
            <VotingNumbers
                abstain={voting.abstain}
                abstainPercentage={voting.abstainPercentage}
                no={voting.no}
                noPercentage={voting.noPercentage}
                quorum={voting.quorum}
                total={voting.total}
                yes={voting.yes}
                yesPercentage={voting.yesPercentage}
            />
        </Surface>
    )
}

export default VotingLoader

// istanbul ignore file
import { BoxIcon } from 'lucide-react'
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getLatestBlockHeight, getVotingEnd } from '@/pages/inspect/explorer/lib/data'
import dayjs from '@/pages/inspect/explorer/lib/dayjs/dayjs'
import { blocksDuration } from '@/pages/inspect/explorer/lib/utils'
import { Props } from './votingEndPanelContainer'

const VotingEndPanelLoader: FC<Props> = async ({ proposalId, ...props }) => {
    const [latestBlockHeight, votingEnd] = await Promise.all([
        getLatestBlockHeight(),
        getVotingEnd(proposalId),
    ])

    if (!latestBlockHeight || !votingEnd) {
        return
    }

    return (
        <NumberPanel
            className={props.className}
            number={votingEnd.endBlockHeight}
            numberClassName="gap-2"
            numberPrefix={<BoxIcon className="text-text-secondary" size={16} />}
            title={`Voting ${votingEnd.votingInProgress ? 'ends' : 'ended'}`}
        >
            <div className="font-mono text-base text-text-secondary">
                {votingEnd.votingInProgress
                    ? blocksDuration(
                          votingEnd.endBlockHeight - latestBlockHeight,
                          'long'
                      )
                    : dayjs(votingEnd.timestamp)
                          .tz('UTC')
                          .format('YYYY-MM-DD HH:mm:ss z')}
            </div>
        </NumberPanel>
    )
}

export default VotingEndPanelLoader

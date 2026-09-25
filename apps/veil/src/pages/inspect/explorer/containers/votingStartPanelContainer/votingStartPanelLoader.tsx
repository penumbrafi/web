// istanbul ignore file
import { BoxIcon } from 'lucide-react'
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getVotingStart } from '@/pages/inspect/explorer/lib/data'
import dayjs from '@/pages/inspect/explorer/lib/dayjs/dayjs'
import type { Props } from './votingStartPanelContainer'

const VotingStartPanelLoader: FC<Props> = async ({ proposalId, ...props }) => {
    const votingStart = await getVotingStart(proposalId)

    if (!votingStart) {
        return
    }

    return (
        <NumberPanel
            className={props.className}
            number={votingStart.blockHeight}
            numberClassName="gap-2"
            numberPrefix={<BoxIcon className="text-text-secondary" size={16} />}
            title="Voting started"
        >
            <div className="font-mono text-base text-text-secondary">
                {dayjs(votingStart.timestamp)
                    .tz('UTC')
                    .format('YYYY-MM-DD HH:mm:ss z')}
            </div>
        </NumberPanel>
    )
}

export default VotingStartPanelLoader

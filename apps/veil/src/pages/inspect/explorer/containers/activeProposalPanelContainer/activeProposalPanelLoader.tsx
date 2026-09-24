// istanbul ignore file
import { FC } from 'react'
import { getActiveProposals, getLatestBlockHeight } from '@/pages/inspect/explorer/lib/data'
import ActiveProposalPanel from './activeProposalPanel'
import { Props } from './activeProposalPanelContainer'

const ActiveProposalPanelLoader: FC<Props> = async props => {
    const [latestBlockHeight, proposals] = await Promise.all([
        getLatestBlockHeight(),
        getActiveProposals(),
    ])

    if (!latestBlockHeight || !proposals?.length) {
        return
    }

    // Render EVERY active proposal. This used to take only `proposals[0]`,
    // and since the past-proposals table excludes active ones, any second
    // proposal in voting vanished from the page entirely (proposals 13 and 14
    // were in voting together and only 14 showed). Soonest-closing first.
    const ordered = [...proposals].sort(
        (a, b) => a.endBlockHeight - b.endBlockHeight || a.id - b.id,
    )

    return (
        <>
            {ordered.map(proposal => (
                <ActiveProposalPanel
                    key={proposal.id}
                    className={props.className}
                    latestBlockHeight={latestBlockHeight}
                    proposal={proposal}
                />
            ))}
        </>
    )
}

export default ActiveProposalPanelLoader

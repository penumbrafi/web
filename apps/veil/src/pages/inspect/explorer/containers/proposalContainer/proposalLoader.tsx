// istanbul ignore file
import { notFound } from 'next/navigation'
import { FC } from 'react'
import {
    JsonTree,
    Parameter,
    Parameters,
    ProposalStatePill,
    ReadMore,
    Surface,
} from '@/pages/inspect/explorer/components'
import getProposal from '@/pages/inspect/explorer/lib/data/getProposal'
import { ProposalState } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { classNames, formatNumber } from '@/pages/inspect/explorer/lib/utils'
import type { Props } from './proposalContainer'
import { VotePanel } from './vote-panel'

const ProposalLoader: FC<Props> = async ({ proposalId, ...props }) => {
    const proposal = await getProposal(proposalId)

    if (!proposal) {
        notFound()
    }

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex flex-col gap-2">
                <div className="flex justify-between">
                    <span className="font-mono text-base">
                        Proposal #{proposal.id}
                    </span>
                    <ProposalStatePill state={proposal.state} />
                </div>
                <h1 className="text-2xl font-medium">{proposal.title}</h1>
                <div className="text-xs text-text-secondary">
                    {proposal.kind}
                </div>
            </header>
            {/* Voting happens here, through the connected wallet. This used to
                link to https://vote.penumbra.zone/, which no longer resolves
                (and whoever re-registers penumbra.zone would control where
                voters land). */}
            {proposal.state === ProposalState.Voting && (
                <VotePanel proposalId={proposal.id} />
            )}
            <ReadMore
                className="text-sm"
                minParagraphs={3}
                text={proposal.description}
            />
            <Parameters>
                <Parameter name="Deposit amount">
                    {formatNumber(proposal.depositAmount)} UM
                </Parameter>
            </Parameters>
            {proposal.rawJson && (
                <JsonTree
                    className="gap-1"
                    data={proposal.rawJson}
                    title="Payload"
                    titleClassName="text-xs"
                />
            )}
        </Surface>
    )
}

export default ProposalLoader

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
import { Props } from './proposalContainer'

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
                <div className="text-text-secondary text-xs">
                    {proposal.kind}
                </div>
                {/* This used to be a "Vote" button to https://vote.penumbra.zone/.
                    That domain belongs to the former core team and no longer
                    resolves, so the button was dead — and if penumbra.zone ever
                    lapsed, whoever registered it would control where voters
                    land. Until voting is built into this page, point at the one
                    working path: the vote screen in the Zafu wallet. */}
                {proposal.state === ProposalState.Voting && (
                    <p className="text-text-secondary text-sm">
                        Voting is open. Cast your vote from the{' '}
                        <strong className="text-text-primary">Vote</strong> screen
                        in the{' '}
                        <a
                            className="underline hover:text-text-primary"
                            href="https://zafu.pro/"
                            rel="noreferrer"
                            target="_blank"
                        >
                            Zafu wallet
                        </a>
                        , which shows this proposal and its full payload before
                        you sign.
                    </p>
                )}
            </header>
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

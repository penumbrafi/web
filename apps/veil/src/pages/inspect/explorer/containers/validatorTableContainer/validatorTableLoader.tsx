// istanbul ignore file
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FC } from 'react'
import { ValidatorTable } from '@/pages/inspect/explorer/components'
import { getValidators } from '@/pages/inspect/explorer/lib/data'
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { fetchValidatorStakeDeltas } from '@/pages/inspect/explorer/server/validator-stake-deltas'
import { fetchValidatorYieldBoard } from '@/pages/inspect/explorer/server/validator-yields'
import { ValidatorYieldSummary } from '@/pages/inspect/explorer/ui/validator-yield-summary'
import type { Props } from './validatorTableContainer'

const ValidatorTableLoader: FC<Props> = async props => {
    const [validators, deltas, yieldBoard] = await Promise.all([
        getValidators({
            state: props.inactive
                ? ValidatorStateFilter.Inactive
                : ValidatorStateFilter.Active,
        }),
        // pindexer DB down -> no delta columns, not a dead table
        fetchValidatorStakeDeltas().catch((err: unknown) => {
            console.warn('[validators] stake deltas unavailable', err)
            return new Map<string, never>()
        }),
        // Stake endpoint or pindexer down -> APY cells render as "—", not a dead table
        fetchValidatorYieldBoard().catch((err: unknown) => {
            console.warn('[validators] validator yields unavailable', err)
            return null
        }),
    ])

    if (!validators) {
        notFound()
    }

    const enriched = validators.map(v => {
        const d = deltas.get(v.id)
        const y = yieldBoard?.byKey[v.id]
        return {
            ...v,
            stakeDelta7d: d?.delta7d ?? 0,
            stakeDelta30d: d?.delta30d ?? 0,
            // supply_total_staked updates per-block; votingPower only at epoch boundaries.
            // Leave undefined when unknown so the display falls back to votingPower.
            currentStake: d && d.current !== 0 ? d.current : undefined,
            // The board covers the whole validator set: outside the active set
            // the yield is a real 0, not an unknown.
            netApyPct: y?.netApyPct,
            realYieldPct: y?.realYieldPct,
            realizedApyPct: y?.realizedApyPct,
        }
    })

    const total = enriched.length
    const truncated = props.limit !== undefined && total > props.limit

    return (
        <ValidatorTable
            {...props}
            header={
                <div className="flex flex-col gap-4">
                    {props.header}
                    {!props.inactive && (
                        <ValidatorYieldSummary board={yieldBoard} />
                    )}
                </div>
            }
            footer={
                <span className="flex items-center gap-2 text-sm text-text-secondary">
                    <span>
                        {truncated ? (
                            <>
                                Showing top {props.limit} of {total}{' '}
                                {props.inactive ? 'inactive' : 'active'} validators
                            </>
                        ) : (
                            <>
                                {total}{' '}
                                {props.inactive ? 'inactive' : 'active'} validators
                            </>
                        )}
                    </span>
                    {truncated && (
                        <Link
                            className="text-text-primary hover:underline"
                            href={
                                props.inactive
                                    ? '/explore/validators?filter=inactive&all=1'
                                    : '/explore/validators?all=1'
                            }
                        >
                            Show all
                        </Link>
                    )}
                </span>
            }
            validators={enriched}
        />
    )
}

export default ValidatorTableLoader

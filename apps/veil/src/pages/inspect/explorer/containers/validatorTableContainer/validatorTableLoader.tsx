// istanbul ignore file
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FC } from 'react'
import { ValidatorTable } from '@/pages/inspect/explorer/components'
import { getValidators } from '@/pages/inspect/explorer/lib/data'
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { fetchValidatorStakeDeltas } from '@/pages/inspect/explorer/server/validator-stake-deltas'
import type { Props } from './validatorTableContainer'

const ValidatorTableLoader: FC<Props> = async props => {
    const [validators, deltas] = await Promise.all([
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
    ])

    if (!validators) {
        notFound()
    }

    const enriched = validators.map(v => {
        const d = deltas.get(v.id)
        return {
            ...v,
            stakeDelta7d: d?.delta7d ?? 0,
            stakeDelta30d: d?.delta30d ?? 0,
            // supply_total_staked updates per-block; votingPower only at epoch boundaries.
            // Leave undefined when unknown so the display falls back to votingPower.
            currentStake: d && d.current !== 0 ? d.current : undefined,
        }
    })

    const total = enriched.length
    const truncated = props.limit !== undefined && total > props.limit

    return (
        <ValidatorTable
            {...props}
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

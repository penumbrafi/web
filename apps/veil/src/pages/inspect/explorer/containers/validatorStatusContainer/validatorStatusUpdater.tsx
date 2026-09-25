// istanbul ignore file
'use client'

import { FC, useEffect, useState } from 'react'
import { Surface } from '@/pages/inspect/explorer/components'
import { useValidatorBlockUpdateSubscription } from '@/pages/inspect/explorer/lib/graphql/generated/hooks'
import { ValidatorBlock } from '@/pages/inspect/explorer/lib/types'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import ValidatorStatusBlocks from './validatorStatusBlocks'
import { Props as ValidatorStatusContainerProps } from './validatorStatusContainer'
import ValidatorStatusLegend from './validatorStatusLegend'

interface Props extends ValidatorStatusContainerProps {
    active?: boolean
    validatorBlocks: ValidatorBlock[]
}

const ValidatorStatusUpdater: FC<Props> = props => {
    const [validatorBlocks, setValidatorBlocks] = useState(
        props.validatorBlocks
    )

    const [validatorBlockSubscription] = useValidatorBlockUpdateSubscription({
        variables: { id: props.validatorId },
    })

    const validatorBlockUpdate =
        validatorBlockSubscription.data?.validatorBlocks

    useEffect(() => {
        if (validatorBlockUpdate) {
            setValidatorBlocks(prev => {
                const newest = prev[0]
                if (newest && validatorBlockUpdate.blockHeight <= newest.height) {
                    return prev
                }

                return [
                    {
                        height: validatorBlockUpdate.blockHeight,
                        signed: validatorBlockUpdate.signed,
                    },
                    ...prev,
                ].slice(0, 300)
            })
        }
    }, [validatorBlockUpdate])

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header>
                <h2 className="inline text-2xl font-medium">
                    Validator status
                </h2>{' '}
                <span className="text-xs text-text-secondary">
                    (Last 300 blocks)
                </span>
            </header>
            {props.active && validatorBlocks[0] ? (
                <div className="flex flex-col gap-2">
                    <ValidatorStatusLegend
                        lastBlock={validatorBlocks[0].height}
                    />
                    <ValidatorStatusBlocks validatorBlocks={validatorBlocks} />
                </div>
            ) : (
                <div
                    className={classNames(
                        'text-text-secondary flex h-25 items-center',
                        'justify-center text-sm'
                    )}
                >
                    No signing activity
                </div>
            )}
        </Surface>
    )
}

export default ValidatorStatusUpdater

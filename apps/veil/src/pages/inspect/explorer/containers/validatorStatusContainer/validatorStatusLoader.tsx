// istanbul ignore file
import { FC } from 'react'
import { getBlocks, getValidatorBlocks } from '@/pages/inspect/explorer/lib/data'
import { ValidatorState } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import GraphqlClientProvider from '@/pages/inspect/explorer/lib/graphql/graphqlClientProvider'
import { Props } from './validatorStatusContainer'
import ValidatorStatusUpdater from './validatorStatusUpdater'

const ValidatorStatusLoader: FC<Props> = async props => {
    const [latestBlocks, validator] = await Promise.all([
        getBlocks({ length: 300 }),
        getValidatorBlocks(props.validatorId),
    ])

    const active = validator?.state === ValidatorState.ValidatorStateEnumActive

    const validatorBlocks = latestBlocks.blocks.map(block => ({
        height: block.height,
        signed: validator?.last300Blocks.find(vb => vb.height === block.height)
            ?.signed,
    }))

    // Mark all unsigned blocks before signed ones as signed to fix timing
    // edge case where regular blocks are ahead of validator blocks
    const firstSignedIndex = validatorBlocks.findIndex(
        block => block.signed === true
    )

    if (firstSignedIndex !== -1) {
        for (let i = 0; i < firstSignedIndex; i++) {
            const block = validatorBlocks[i]

            if (block && typeof block.signed === 'undefined') {
                block.signed = true
            }
        }
    }

    return (
        <GraphqlClientProvider>
            <ValidatorStatusUpdater
                active={active}
                validatorBlocks={validatorBlocks ?? []}
                {...props}
            />
        </GraphqlClientProvider>
    )
}

export default ValidatorStatusLoader

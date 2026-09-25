// istanbul ignore file
import { notFound } from 'next/navigation'
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import getActiveValidators from '@/pages/inspect/explorer/lib/data/getActiveValidators'
import { Props } from './activeValidatorsPanelContainer'

const ActiveValidatorsPanelLoader: FC<Props> = async props => {
    const activeValidators = await getActiveValidators()

    if (!activeValidators) {
        notFound()
    }

    return (
        <NumberPanel
            className={props.className}
            number={activeValidators.activeValidatorCount}
            numberSuffix={
                <span className="text-2xl text-text-secondary">
                    /{activeValidators.activeValidatorLimit}
                </span>
            }
            title="Active validators / Validators limit"
        />
    )
}

export default ActiveValidatorsPanelLoader

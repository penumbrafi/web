// istanbul ignore file
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getMinValidatorStake } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './minValidatorStakePanelContainer'

const MinValidatorStakePanelLoader: FC<Props> = async props => {
    const number = await getMinValidatorStake()

    return (
        <NumberPanel
            {...props}
            number={number ?? 0}
            numberClassName="gap-2"
            numberSuffix="UM"
            title="Min validator stake"
        />
    )
}

export default MinValidatorStakePanelLoader

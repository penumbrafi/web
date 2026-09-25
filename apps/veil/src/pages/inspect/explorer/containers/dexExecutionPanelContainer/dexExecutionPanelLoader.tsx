// istanbul ignore file
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getDexTotalExecutions } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './dexExecutionPanelContainer'

const DexExecutionPanelLoader: FC<Props> = async props => {
    const number = await getDexTotalExecutions()

    return (
        <NumberPanel
            className={props.className}
            number={number ?? 0}
            title="Number of executions"
        />
    )
}

export default DexExecutionPanelLoader

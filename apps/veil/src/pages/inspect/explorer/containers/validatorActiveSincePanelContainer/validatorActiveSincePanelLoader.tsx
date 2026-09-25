// istanbul ignore file
import { FC } from 'react'
import { Panel } from '@/pages/inspect/explorer/components'
import { getValidatorActiveSince } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './validatorActiveSincePanelContainer'

const ValidatorActiveSincePanelLoader: FC<Props> = async props => {
    const activeSince = await getValidatorActiveSince(props.validatorId)

    return (
        <Panel
            className={props.className}
            header={
                <span className="font-mono text-3xl font-medium">
                    {activeSince}
                </span>
            }
            title="Defined"
        />
    )
}

export default ValidatorActiveSincePanelLoader

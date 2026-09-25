// istanbul ignore file
import Image from 'next/image'
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getActiveVotingPower } from '@/pages/inspect/explorer/lib/data'
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { penumbraImage } from '@/pages/inspect/explorer/lib/images'
import type { Props } from './activeVotingPowerPanelContainer'

const titleFor = (state?: ValidatorStateFilter): string => {
    if (state === ValidatorStateFilter.Inactive) {return 'Inactive bonded stake'}
    if (state === ValidatorStateFilter.Active) {return 'Active bonded stake'}
    return 'Bonded stake'
}

const ActiveVotingPowerPanelLoader: FC<Props> = async props => {
    const number = await getActiveVotingPower(props.state)

    return (
        <NumberPanel
            {...props}
            number={number ?? 0}
            numberClassName="gap-2"
            numberPrefix={
                <Image alt="UM" height={32} src={penumbraImage} width={32} />
            }
            numberSuffix="UM"
            title={titleFor(props.state)}
        />
    )
}

export default ActiveVotingPowerPanelLoader

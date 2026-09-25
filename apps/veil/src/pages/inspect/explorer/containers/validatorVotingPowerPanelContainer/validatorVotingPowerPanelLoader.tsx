// istanbul ignore file
import Image from 'next/image'
import { FC } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { getValidatorVotingPower } from '@/pages/inspect/explorer/lib/data'
import { ValidatorState } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { penumbraImage } from '@/pages/inspect/explorer/lib/images'
import type { Props } from './validatorVotingPowerPanelContainer'

const ValidatorVotingPowerPanelLoader: FC<Props> = async props => {
    const validator = await getValidatorVotingPower(props.validatorId)
    const number = validator?.votingPower
    const active = validator?.state === ValidatorState.ValidatorStateEnumActive

    return (
        <NumberPanel
            className={props.className}
            number={number ?? 0}
            numberClassName="gap-2"
            numberPrefix={
                <Image alt="UM" height={32} src={penumbraImage} width={32} />
            }
            numberSuffix="UM"
            title={active ? 'Voting power UM' : 'Staked tokens'}
        />
    )
}

export default ValidatorVotingPowerPanelLoader

// istanbul ignore file
import Image from 'next/image'
import { FC, Suspense } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { penumbraImage } from '@/pages/inspect/explorer/lib/images'
import ActiveVotingPowerPanelLoader from './activeVotingPowerPanelLoader'

export interface Props {
    className?: string
    state?: ValidatorStateFilter
}

const titleFor = (state?: ValidatorStateFilter): string => {
    if (state === ValidatorStateFilter.Inactive) {return 'Inactive bonded stake'}
    if (state === ValidatorStateFilter.Active) {return 'Active bonded stake'}
    return 'Bonded stake'
}

const ActiveVotingPowerPanelContainer: FC<Props> = props => (
    <Suspense
        fallback={
            <NumberPanel
                className={props.className}
                number={0}
                numberClassName="gap-2"
                numberPrefix={
                    <Image
                        alt="UM"
                        height={32}
                        src={penumbraImage}
                        width={32}
                    />
                }
                numberSuffix="UM"
                title={titleFor(props.state)}
            />
        }
    >
        <ActiveVotingPowerPanelLoader {...props} />
    </Suspense>
)

export default ActiveVotingPowerPanelContainer

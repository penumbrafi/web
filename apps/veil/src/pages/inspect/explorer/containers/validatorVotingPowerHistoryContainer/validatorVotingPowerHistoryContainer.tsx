// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton, Surface } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import ValidatorVotingPowerHistoryLoader from './validatorVotingPowerHistoryLoader'

export interface Props {
    className?: string
    validatorId: string
}

const ValidatorVotingPowerHistoryContainer: FC<Props> = props => (
    <Suspense
        fallback={
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-4 sm:p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-xl font-medium sm:text-2xl">Staking history</h2>
                </header>
                <Skeleton
                    className={classNames('h-95 rounded-sm sm:h-72 md:h-100')}
                />
            </Surface>
        }
    >
        <ValidatorVotingPowerHistoryLoader {...props} />
    </Suspense>
)

export default ValidatorVotingPowerHistoryContainer

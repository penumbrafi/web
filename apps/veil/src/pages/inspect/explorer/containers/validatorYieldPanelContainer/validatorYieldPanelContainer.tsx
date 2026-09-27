// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import ValidatorYieldPanelLoader from './validatorYieldPanelLoader'

export interface Props {
    className?: string
    validatorId: string
}

const ValidatorYieldPanelContainer: FC<Props> = props => (
    <Suspense fallback={<Skeleton className={classNames('h-56', props.className)} />}>
        <ValidatorYieldPanelLoader {...props} />
    </Suspense>
)

export default ValidatorYieldPanelContainer

// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton, Surface } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import ValidatorLoader from './validatorLoader'

export interface Props {
    className?: string
    validatorId: string
}

const ValidatorContainer: FC<Props> = props => (
    <Suspense
        fallback={
            <Surface
                as="section"
                className={classNames('p-4 sm:p-6', props.className)}
            >
                <Skeleton className="h-125 rounded-sm" />
            </Surface>
        }
    >
        <ValidatorLoader {...props} />
    </Suspense>
)

export default ValidatorContainer

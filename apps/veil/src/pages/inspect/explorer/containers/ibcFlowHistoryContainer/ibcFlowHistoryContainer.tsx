// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton, Surface } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import IbcFlowHistoryLoader from './ibcFlowHistoryLoader'

export interface Props {
    className?: string
    clientId?: string
    days?: number
    timeRangeSelector?: React.ReactNode
}

const IbcFlowHistoryContainer: FC<Props> = props => (
    <Suspense
        key={`${props.clientId}-${props.days}`}
        fallback={
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-4 sm:p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-xl font-medium sm:text-2xl">
                        IBC inflows & outflows
                    </h2>
                </header>
                <Skeleton className="h-95 rounded-sm sm:h-72 md:h-100" />
            </Surface>
        }
    >
        <IbcFlowHistoryLoader {...props} />
    </Suspense>
)

export default IbcFlowHistoryContainer

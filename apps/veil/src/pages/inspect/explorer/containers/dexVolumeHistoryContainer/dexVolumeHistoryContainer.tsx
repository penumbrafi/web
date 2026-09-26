// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton, Surface } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import DexVolumeHistoryLoader from './dexVolumeHistoryLoader'

export interface Props {
    className?: string
    days?: number
    timeRangeSelector?: React.ReactNode
}

const DexVolumeHistoryContainer: FC<Props> = props => (
    <Suspense
        key={props.days}
        fallback={
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-4 sm:p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-xl font-medium sm:text-2xl">Swap volume</h2>
                </header>
                <Skeleton className="h-95 rounded-sm sm:h-72 md:h-100" />
            </Surface>
        }
    >
        <DexVolumeHistoryLoader {...props} />
    </Suspense>
)

export default DexVolumeHistoryContainer

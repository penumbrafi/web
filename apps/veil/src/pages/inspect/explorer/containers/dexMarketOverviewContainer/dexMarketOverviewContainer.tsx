// istanbul ignore file
import { FC, Suspense } from 'react'
import { Skeleton, Surface } from '@/pages/inspect/explorer/components'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import DexMarketOverviewLoader from './dexMarketOverviewLoader'

export interface Props {
    className?: string
}

const DexMarketOverviewContainer: FC<Props> = props => (
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
                    <h2 className="text-xl font-medium sm:text-2xl">Market overview</h2>
                </header>
                <Skeleton className="h-60 rounded-sm" />
            </Surface>
        }
    >
        <DexMarketOverviewLoader {...props} />
    </Suspense>
)

export default DexMarketOverviewContainer

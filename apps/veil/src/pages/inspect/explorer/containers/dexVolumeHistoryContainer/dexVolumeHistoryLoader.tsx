// istanbul ignore file
import { FC } from 'react'
import { Surface, SwapVolumeChart } from '@/pages/inspect/explorer/components'
import getSwapVolumeHistory from '@/pages/inspect/explorer/lib/data/getSwapVolumeHistory'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import type { Props } from './dexVolumeHistoryContainer'

const DexVolumeHistoryLoader: FC<Props> = async props => {
    const days = props.days || 30
    const history = await getSwapVolumeHistory(days)

    if (!history || history.length === 0) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">Swap volume</h2>
                </header>
                <p className="text-text-secondary">
                    No swap volume data available yet.
                </p>
            </Surface>
        )
    }

    const totalSwaps = history.reduce((sum, d) => sum + d.swapCount, 0)
    const totalArbs = history.reduce((sum, d) => sum + d.arbCount, 0)
    const totalOrganic = history.reduce((sum, d) => sum + d.organicCount, 0)

    const chartData = history.map(d => ({
        arb: d.arbCount,
        date: d.date,
        organic: d.organicCount,
        total: d.swapCount,
    }))

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-baseline gap-3">
                    <h2 className="text-2xl font-medium">Swap volume</h2>
                    <span className="text-sm text-text-secondary">
                        {totalSwaps.toLocaleString('en-US')} swaps in {days}d
                    </span>
                </div>
                {props.timeRangeSelector}
            </header>

            <div className="grid grid-cols-3 gap-4">
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">
                        Total swaps
                    </div>
                    <div className="mt-1 text-lg font-medium">
                        {totalSwaps.toLocaleString('en-US')}
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">Organic</div>
                    <div className="mt-1 text-lg font-medium text-blue-500">
                        {totalOrganic.toLocaleString('en-US')}
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">Arbitrage</div>
                    <div className="mt-1 text-lg font-medium text-amber-500">
                        {totalArbs.toLocaleString('en-US')}
                    </div>
                </div>
            </div>

            <SwapVolumeChart data={chartData} />
        </Surface>
    )
}

export default DexVolumeHistoryLoader

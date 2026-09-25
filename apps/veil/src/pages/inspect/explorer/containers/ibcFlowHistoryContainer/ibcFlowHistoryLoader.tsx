// istanbul ignore file
import { FC } from 'react'
import { IbcFlowChart, Surface } from '@/pages/inspect/explorer/components'
import { getIbcFlowHistory } from '@/pages/inspect/explorer/lib/data/getIbcFlowHistory'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import type { Props } from './ibcFlowHistoryContainer'

const IbcFlowHistoryLoader: FC<Props> = async props => {
    const days = props.days || 30
    const history = await getIbcFlowHistory(props.clientId, days)

    if (history.length === 0) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">
                        IBC inflows & outflows
                    </h2>
                </header>
                <p className="text-text-secondary">
                    No IBC flow data available yet.
                </p>
            </Surface>
        )
    }

    const totalInflows = history.reduce((sum, d) => sum + d.inflowCount, 0)
    const totalOutflows = history.reduce((sum, d) => sum + d.outflowCount, 0)

    const chartData = history.map(d => ({
        date: d.date,
        inflow: d.inflowCount,
        outflow: d.outflowCount,
    }))

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-baseline gap-3">
                    <h2 className="text-2xl font-medium">
                        IBC inflows & outflows
                    </h2>
                    <span className="text-sm text-text-secondary">
                        {(totalInflows + totalOutflows).toLocaleString('en-US')}{' '}
                        transfers in {days}d
                    </span>
                </div>
                {props.timeRangeSelector}
            </header>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">
                        Total transfers
                    </div>
                    <div className="mt-1 text-lg font-medium">
                        {(totalInflows + totalOutflows).toLocaleString('en-US')}
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">
                        Inflows (shielded)
                    </div>
                    <div className="mt-1 text-lg font-medium text-green-500">
                        {totalInflows.toLocaleString('en-US')}
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-xs text-text-secondary">
                        Outflows (unshielded)
                    </div>
                    <div className="mt-1 text-lg font-medium text-amber-500">
                        {totalOutflows.toLocaleString('en-US')}
                    </div>
                </div>
            </div>

            <IbcFlowChart data={chartData} />
        </Surface>
    )
}

export default IbcFlowHistoryLoader

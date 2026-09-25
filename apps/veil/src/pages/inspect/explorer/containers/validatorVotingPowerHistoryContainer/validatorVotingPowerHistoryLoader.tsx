// istanbul ignore file
import { FC } from 'react'
import { StakingHistoryChart, Surface } from '@/pages/inspect/explorer/components'
import { getValidatorVotingPowerHistory } from '@/pages/inspect/explorer/lib/data'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import { Props } from './validatorVotingPowerHistoryContainer'

const ValidatorVotingPowerHistoryLoader: FC<Props> = async props => {
    const history = await getValidatorVotingPowerHistory(
        props.validatorId,
        undefined,
        undefined,
        500
    )

    const firstEntry = history?.[0]
    const lastEntry = history?.[history.length - 1]
    if (!history || !firstEntry || !lastEntry) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">Staking history</h2>
                </header>
                <p className="text-text-secondary">
                    No staking history data available yet.
                </p>
            </Surface>
        )
    }

    // Calculate total change
    const totalChange = lastEntry.votingPower - firstEntry.votingPower
    const percentChange =
        firstEntry.votingPower > 0
            ? ((totalChange / firstEntry.votingPower) * 100).toFixed(2)
            : '0'

    // Prepare chart data (sorted chronologically)
    const chartData = [...history].sort(
        (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex items-baseline justify-between">
                <h2 className="text-2xl font-medium">Staking history</h2>
                <div className="text-sm">
                    <span className="text-text-secondary">
                        Last {history.length} changes
                    </span>
                </div>
            </header>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-text-secondary text-xs">Current</div>
                    <div className="mt-1 text-lg font-medium">
                        {lastEntry.votingPower.toLocaleString('en-US')} UM
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-text-secondary text-xs">Initial</div>
                    <div className="mt-1 text-lg font-medium">
                        {firstEntry.votingPower.toLocaleString('en-US')} UM
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-text-secondary text-xs">Change</div>
                    <div
                        className={classNames(
                            'mt-1 text-lg font-medium',
                            totalChange > 0
                                ? 'text-green-500'
                                : totalChange < 0
                                  ? 'text-red-500'
                                  : ''
                        )}
                    >
                        {totalChange > 0 ? '+' : ''}
                        {totalChange.toLocaleString('en-US')} UM
                    </div>
                </div>
                <div className="bg-surface-secondary rounded-lg p-4">
                    <div className="text-text-secondary text-xs">% Change</div>
                    <div
                        className={classNames(
                            'mt-1 text-lg font-medium',
                            totalChange > 0
                                ? 'text-green-500'
                                : totalChange < 0
                                  ? 'text-red-500'
                                  : ''
                        )}
                    >
                        {totalChange > 0 ? '+' : ''}
                        {percentChange}%
                    </div>
                </div>
            </div>

            <StakingHistoryChart data={chartData} />

            <details className="text-sm">
                <summary className="text-text-secondary hover:text-text-primary cursor-pointer">
                    Show data table
                </summary>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-border-secondary border-b">
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Block
                                </th>
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Voting Power
                                </th>
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Change
                                </th>
                                <th className="pb-2 text-left font-medium">
                                    Time
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((entry, index) => {
                                const prevEntry =
                                    index > 0 ? history[index - 1] : null
                                const change = prevEntry
                                    ? entry.votingPower - prevEntry.votingPower
                                    : 0

                                return (
                                    <tr
                                        key={entry.blockHeight}
                                        className="border-border-secondary border-b"
                                    >
                                        <td className="py-3 pr-4 font-mono">
                                            {entry.blockHeight.toLocaleString('en-US')}
                                        </td>
                                        <td className="py-3 pr-4">
                                            {entry.votingPower.toLocaleString('en-US')}{' '}
                                            UM
                                        </td>
                                        <td
                                            className={classNames(
                                                'py-3 pr-4',
                                                change > 0
                                                    ? 'text-green-500'
                                                    : change < 0
                                                      ? 'text-red-500'
                                                      : 'text-text-secondary'
                                            )}
                                        >
                                            {index === 0
                                                ? '-'
                                                : `${change > 0 ? '+' : ''}${change.toLocaleString('en-US')}`}
                                        </td>
                                        <td className="text-text-secondary py-3">
                                            {new Date(
                                                entry.timestamp
                                            ).toLocaleString('en-US', { timeZone: 'UTC' })}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </details>
        </Surface>
    )
}

export default ValidatorVotingPowerHistoryLoader

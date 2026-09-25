// istanbul ignore file
import { FC } from 'react'
import { DelegationFlowChart, Surface } from '@/pages/inspect/explorer/components'
import getValidatorDelegates from '@/pages/inspect/explorer/lib/data/getValidatorDelegates'
import getValidatorStakingStats from '@/pages/inspect/explorer/lib/data/getValidatorStakingStats'
import getValidatorUndelegates from '@/pages/inspect/explorer/lib/data/getValidatorUndelegates'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import { Props } from './validatorDelegationFlowContainer'

// Aggregate events by day from raw delegate/undelegate records
function aggregateByDay(
    delegates: { timestamp: string; unbondedAmount: string }[],
    undelegates: { timestamp: string; unbondedAmount: string }[]
): { date: string; delegated: number; undelegated: number }[] {
    const dayMap = new Map<string, { delegated: number; undelegated: number }>()

    for (const d of delegates) {
        const day = d.timestamp.slice(0, 10)
        const entry = dayMap.get(day) || { delegated: 0, undelegated: 0 }
        entry.delegated += Number(d.unbondedAmount) / 1_000_000
        dayMap.set(day, entry)
    }

    for (const u of undelegates) {
        const day = u.timestamp.slice(0, 10)
        const entry = dayMap.get(day) || { delegated: 0, undelegated: 0 }
        entry.undelegated += Number(u.unbondedAmount) / 1_000_000
        dayMap.set(day, entry)
    }

    return Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({
            date,
            delegated: Math.round(values.delegated),
            undelegated: Math.round(values.undelegated),
        }))
}

function formatUm(raw: string): string {
    const num = Number(raw) / 1_000_000
    if (num >= 1_000_000) {return `${(num / 1_000_000).toFixed(2)}M`}
    if (num >= 1_000) {return `${(num / 1_000).toFixed(1)}K`}
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const ValidatorDelegationFlowLoader: FC<Props> = async props => {
    const [delegates, undelegates, stats] = await Promise.all([
        getValidatorDelegates(props.validatorId, 100),
        getValidatorUndelegates(props.validatorId, 100),
        getValidatorStakingStats(props.validatorId),
    ])

    const hasData = delegates.length > 0 || undelegates.length > 0

    if (!hasData) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">Delegation flow</h2>
                </header>
                <p className="text-text-secondary">
                    No delegation data available yet.
                </p>
            </Surface>
        )
    }

    const chartData = aggregateByDay(delegates, undelegates)

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex items-baseline justify-between">
                <h2 className="text-2xl font-medium">Delegation flow</h2>
                <div className="text-sm">
                    <span className="text-text-secondary">
                        {delegates.length} delegates, {undelegates.length}{' '}
                        undelegates
                    </span>
                </div>
            </header>

            {stats && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="bg-surface-secondary rounded-lg p-4">
                        <div className="text-xs text-text-secondary">
                            Total delegated
                        </div>
                        <div className="mt-1 text-lg font-medium text-green-500">
                            {formatUm(stats.totalDelegations)} UM
                        </div>
                    </div>
                    <div className="bg-surface-secondary rounded-lg p-4">
                        <div className="text-xs text-text-secondary">
                            Total undelegated
                        </div>
                        <div className="mt-1 text-lg font-medium text-red-500">
                            {formatUm(stats.totalUndelegations)} UM
                        </div>
                    </div>
                    <div className="bg-surface-secondary rounded-lg p-4">
                        <div className="text-xs text-text-secondary">
                            Pending undelegations
                        </div>
                        <div className="mt-1 text-lg font-medium">
                            {stats.pendingUndelegateCount}
                            <span className="ml-1 text-sm text-text-secondary">
                                ({formatUm(stats.pendingUndelegations)} UM)
                            </span>
                        </div>
                    </div>
                    <div className="bg-surface-secondary rounded-lg p-4">
                        <div className="text-xs text-text-secondary">
                            Next release height
                        </div>
                        <div className="mt-1 text-lg font-medium">
                            {stats.nextReleaseHeight
                                ? stats.nextReleaseHeight.toLocaleString('en-US')
                                : '-'}
                        </div>
                    </div>
                </div>
            )}

            <DelegationFlowChart data={chartData} />

            <details className="text-sm">
                <summary className="cursor-pointer text-text-secondary hover:text-text-primary">
                    Show recent delegations
                </summary>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-border-secondary border-b">
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Type
                                </th>
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Amount (UM)
                                </th>
                                <th className="pr-4 pb-2 text-left font-medium">
                                    Block
                                </th>
                                <th className="pb-2 text-left font-medium">
                                    Time
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                ...delegates.map(d => ({
                                    ...d,
                                    type: 'delegate' as const,
                                })),
                                ...undelegates.map(u => ({
                                    ...u,
                                    type: 'undelegate' as const,
                                })),
                            ]
                                .sort(
                                    (a, b) =>
                                        new Date(b.timestamp).getTime() -
                                        new Date(a.timestamp).getTime()
                                )
                                .slice(0, 50)
                                .map(entry => (
                                    <tr
                                        key={`${entry.type}-${entry.id}`}
                                        className="border-border-secondary border-b"
                                    >
                                        <td
                                            className={classNames(
                                                'py-3 pr-4 font-medium',
                                                entry.type === 'delegate'
                                                    ? 'text-green-500'
                                                    : 'text-red-500'
                                            )}
                                        >
                                            {entry.type === 'delegate'
                                                ? 'Delegate'
                                                : 'Undelegate'}
                                        </td>
                                        <td className="py-3 pr-4 font-mono">
                                            {formatUm(entry.unbondedAmount)}
                                        </td>
                                        <td className="py-3 pr-4 font-mono">
                                            {entry.blockHeight.toLocaleString('en-US')}
                                        </td>
                                        <td className="py-3 text-text-secondary">
                                            {new Date(
                                                entry.timestamp
                                            ).toLocaleString('en-US', { timeZone: 'UTC' })}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </Surface>
    )
}

export default ValidatorDelegationFlowLoader

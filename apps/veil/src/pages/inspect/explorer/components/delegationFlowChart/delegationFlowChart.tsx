'use client'

import { FC, useMemo } from 'react'
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

export interface DelegationFlowEntry {
    date: string
    delegated: number
    undelegated: number
}

interface Props {
    data: DelegationFlowEntry[]
}

const formatDate = (date: string) => {
    const d = new Date(date)
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}

const formatAmount = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
    return value.toLocaleString('en-US')
}

const CustomTooltip: FC<any> = ({ active, label, payload }) => {
    if (!active || !payload?.length) return null
    return (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg">
            <div className="text-text-secondary">
                {new Date(label).toLocaleDateString('en-US', { timeZone: 'UTC' })}
            </div>
            {payload.map((entry: any) => (
                <div
                    key={entry.name}
                    className="mt-1"
                    style={{ color: entry.color }}
                >
                    {entry.name}: {Number(entry.value).toLocaleString('en-US')} UM
                </div>
            ))}
        </div>
    )
}

const DelegationFlowChart: FC<Props> = ({ data }) => {
    const domain = useMemo(() => {
        const allValues = data.flatMap(d => [d.delegated, d.undelegated])
        const max = Math.max(...allValues, 0)
        return [0, Math.ceil(max * 1.1) || 1]
    }, [data])

    return (
        <ResponsiveContainer height={320} width="100%">
            <BarChart
                data={data}
                margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
            >
                <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                <XAxis
                    dataKey="date"
                    fontSize={12}
                    stroke="#666"
                    tickFormatter={formatDate}
                    tickLine={false}
                />
                <YAxis
                    domain={domain}
                    fontSize={12}
                    stroke="#666"
                    tickFormatter={formatAmount}
                    tickLine={false}
                    width={60}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar
                    dataKey="delegated"
                    fill="#22c55e"
                    name="Delegated"
                    radius={[2, 2, 0, 0]}
                />
                <Bar
                    dataKey="undelegated"
                    fill="#ef4444"
                    name="Undelegated"
                    radius={[2, 2, 0, 0]}
                />
            </BarChart>
        </ResponsiveContainer>
    )
}

export default DelegationFlowChart

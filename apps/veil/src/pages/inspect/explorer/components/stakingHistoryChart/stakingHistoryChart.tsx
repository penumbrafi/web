'use client'

import { FC, useMemo } from 'react'
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

export interface StakingHistoryEntry {
    blockHeight: number
    timestamp: string
    votingPower: number
}

interface Props {
    data: StakingHistoryEntry[]
}

const formatDate = (timestamp: string) => {
    const d = new Date(timestamp)
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}

const formatPower = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
    return value.toLocaleString('en-US')
}

const CustomTooltip: FC<any> = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const entry = payload[0].payload as StakingHistoryEntry
    return (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg">
            <div className="text-text-secondary">
                {new Date(entry.timestamp).toLocaleString('en-US', { timeZone: 'UTC' })}
            </div>
            <div className="mt-1 font-medium">
                {entry.votingPower.toLocaleString('en-US')} UM
            </div>
            <div className="text-text-secondary text-xs">
                Block {entry.blockHeight.toLocaleString('en-US')}
            </div>
        </div>
    )
}

const StakingHistoryChart: FC<Props> = ({ data }) => {
    const domain = useMemo(() => {
        const powers = data.map(d => d.votingPower)
        const min = Math.min(...powers)
        const max = Math.max(...powers)
        const padding = (max - min) * 0.1 || max * 0.05
        return [
            Math.max(0, Math.floor(min - padding)),
            Math.ceil(max + padding),
        ]
    }, [data])

    return (
        <ResponsiveContainer height={320} width="100%">
            <AreaChart
                data={data}
                margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
            >
                <defs>
                    <linearGradient
                        id="stakingGradient"
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="1"
                    >
                        <stop
                            offset="5%"
                            stopColor="#8b5cf6"
                            stopOpacity={0.3}
                        />
                        <stop
                            offset="95%"
                            stopColor="#8b5cf6"
                            stopOpacity={0}
                        />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                <XAxis
                    dataKey="timestamp"
                    fontSize={12}
                    stroke="#666"
                    tickFormatter={formatDate}
                    tickLine={false}
                />
                <YAxis
                    domain={domain}
                    fontSize={12}
                    stroke="#666"
                    tickFormatter={formatPower}
                    tickLine={false}
                    width={60}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                    activeDot={{ fill: '#8b5cf6', r: 4 }}
                    dataKey="votingPower"
                    dot={false}
                    fill="url(#stakingGradient)"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    type="monotone"
                />
            </AreaChart>
        </ResponsiveContainer>
    )
}

export default StakingHistoryChart

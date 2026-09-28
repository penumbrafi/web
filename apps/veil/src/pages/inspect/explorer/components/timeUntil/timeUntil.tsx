'use client'

import { FC } from 'react'
import { useTicker } from '@/pages/inspect/explorer/lib/hooks'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface Props {
    timestamp: number
}

/**
 * How long until `timestamp`: "2d 6hr" while it is ahead, the usual "3mo ago"
 * once it has passed. TimeAgo cannot do the first half — the explorer's dayjs
 * locale renders every future time as "0s ago" (so a slightly-ahead clock
 * never shows "in 5s"), which is useless for a deadline.
 */
const TimeUntil: FC<Props> = props => {
    const now = useTicker()
    const left = props.timestamp - now.valueOf()

    if (left <= 0) {
        return now.to(props.timestamp)
    }
    if (left >= DAY) {
        return `${Math.floor(left / DAY)}d ${Math.floor((left % DAY) / HOUR)}hr`
    }
    if (left >= HOUR) {
        return `${Math.floor(left / HOUR)}hr ${Math.floor((left % HOUR) / MINUTE)}min`
    }

    return `${Math.max(1, Math.floor(left / MINUTE))}min`
}

export default TimeUntil

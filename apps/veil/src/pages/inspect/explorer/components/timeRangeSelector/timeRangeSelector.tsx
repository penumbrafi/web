'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FC, useCallback } from 'react'
import Density from '../density'
import SegmentedControl from '../segmentedControl'
import { nonEmpty } from '@/pages/inspect/explorer/lib/utils'

interface Props {
    className?: string
    paramName?: string
    ranges: { label: string; value: string }[]
    selectedRange?: string
}

const TimeRangeSelector: FC<Props> = props => {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const router = useRouter()
    const paramName = nonEmpty(props.paramName) ?? 'range'
    const selectedRange = props.selectedRange ?? props.ranges.at(0)?.value

    const onChange = useCallback(
        (value: string) => {
            if (!value || value === selectedRange) {
                return
            }

            const params = new URLSearchParams(searchParams ?? undefined)

            if (value === props.ranges.at(0)?.value) {
                params.delete(paramName)
            } else {
                params.set(paramName, value)
            }

            params.delete('page')

            const queryString = params.toString()
            router.push(`${pathname}${queryString ? `?${queryString}` : ''}`)
        },
        [paramName, pathname, props.ranges, router, searchParams, selectedRange]
    )

    if (!selectedRange) {
        return null
    }

    return (
        <Density compact>
            <SegmentedControl
                className={props.className}
                onChange={onChange}
                value={selectedRange}
            >
                {props.ranges.map(range => (
                    <SegmentedControl.Item
                        key={range.value}
                        style="filled"
                        value={range.value}
                    >
                        {range.label}
                    </SegmentedControl.Item>
                ))}
            </SegmentedControl>
        </Density>
    )
}

export default TimeRangeSelector

import { FC } from 'react'
import { classNames } from '@/pages/inspect/explorer/lib/utils'

interface Props {
    className?: string
    filtered?: boolean
    length: number
    offset?: number
    total: number
}

const ResultCount: FC<Props> = props => {
    const start = (props.offset || 0) + 1
    const end = Math.min((props.offset || 0) + props.length, props.total)

    return (
        <span
            className={classNames(
                'text-text-secondary text-sm',
                props.className
            )}
        >
            Showing {start.toLocaleString('en-US')}-{end.toLocaleString('en-US')} of{' '}
            {props.total.toLocaleString('en-US')}
            {props.filtered && ' (filtered)'}
        </span>
    )
}

export default ResultCount

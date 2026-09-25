import { ArrowDownIcon } from 'lucide-react'
import { FC } from 'react'
import { classNames, formatNumber } from '@/pages/inspect/explorer/lib/utils'
import styles from './validatorStatusContainer.module.css'

interface Props {
    lastBlock: number
}

const ValidatorStatusLegend: FC<Props> = props => (
    <div
        className={classNames(
            'text-text-secondary flex flex-col-reverse justify-between gap-4',
            'font-mono text-sm lg:flex-row lg:items-center lg:gap-0'
        )}
    >
        <span className="inline-flex items-center gap-1">
            <ArrowDownIcon className="inline" size={16} />
            <span>Last block</span>
            <span className="ml-1 text-text-primary">
                {formatNumber(props.lastBlock)}
            </span>
        </span>
        <span
            className={classNames(
                'inline-flex items-center justify-between gap-4',
                'sm:justify-start'
            )}
        >
            <span className="inline-flex items-center gap-2">
                <span className={classNames(styles['block'], styles['signed'])} />
                Signed
            </span>
            <span className="inline-flex items-center gap-2">
                <span className={classNames(styles['block'], styles['missed'])} />
                Missed
            </span>
            <span className="inline-flex items-center gap-2">
                <span className={styles['block']} />
                Inactive
            </span>
        </span>
    </div>
)

export default ValidatorStatusLegend

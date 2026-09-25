// istanbul ignore file
import { FC, Suspense } from 'react'
import { NumberPanel } from '@/pages/inspect/explorer/components'
import ActiveValidatorsPanelLoader from './activeValidatorsPanelLoader'

export interface Props {
    className?: string
}

const ActiveValidatorsPanelContainer: FC<Props> = props => (
    <Suspense
        fallback={
            <NumberPanel
                {...props}
                number={0}
                numberSuffix={
                    <span className="text-2xl text-text-secondary">/0</span>
                }
                title="Active validators / Validators limit"
            />
        }
    >
        <ActiveValidatorsPanelLoader {...props} />
    </Suspense>
)

export default ActiveValidatorsPanelContainer

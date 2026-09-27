// istanbul ignore file
import { FC } from 'react'
import { fetchValidatorYield } from '@/pages/inspect/explorer/server/validator-yields'
import { ValidatorYieldPanel } from '@/pages/inspect/explorer/ui/validator-yield-panel'
import type { Props } from './validatorYieldPanelContainer'

const ValidatorYieldPanelLoader: FC<Props> = async props => {
    // Stake endpoint or pindexer down -> the panel says so; the rest of the
    // page (chain-backed panels) still renders.
    const snapshot = await fetchValidatorYield(props.validatorId).catch(
        (err: unknown) => {
            console.warn('[validator page] rewards unavailable', err)
            return null
        }
    )

    return <ValidatorYieldPanel className={props.className} snapshot={snapshot} />
}

export default ValidatorYieldPanelLoader

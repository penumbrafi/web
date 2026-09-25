// istanbul ignore file
import { FC } from 'react'
import { UmPrice } from '@/pages/inspect/explorer/components'
import { getUmPrice } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './umPriceContainer'

const UmPriceLoader: FC<Props> = async props => {
    const umPrice = await getUmPrice()

    if (!umPrice) {
        return
    }

    return <UmPrice className={props.className} {...umPrice} />
}

export default UmPriceLoader

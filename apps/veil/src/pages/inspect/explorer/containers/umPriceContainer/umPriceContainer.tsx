// istanbul ignore file
'use client'

import { FC, useEffect, useState } from 'react'
import { Skeleton, UmPrice } from '@/pages/inspect/explorer/components'
import { getUmPrice } from '@/pages/inspect/explorer/lib/data'
import { UmPriceData } from '@/pages/inspect/explorer/lib/types'
import { classNames } from '@/pages/inspect/explorer/lib/utils'

export interface Props {
    className?: string
}

const UmPriceContainer: FC<Props> = props => {
    const [umPrice, setUmPrice] = useState<UmPriceData>()

    useEffect(() => {
        void getUmPrice().then(setUmPrice)
    }, [])

    return umPrice ? (
        <UmPrice className={props.className} {...umPrice} />
    ) : (
        <Skeleton
            className={classNames('h-8 w-49 rounded-full', props.className)}
        />
    )
}

export default UmPriceContainer

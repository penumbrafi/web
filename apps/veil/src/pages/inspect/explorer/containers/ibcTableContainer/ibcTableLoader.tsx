// istanbul ignore file
import { notFound } from 'next/navigation'
import { FC } from 'react'
import { IbcTable } from '@/pages/inspect/explorer/components'
import { getIbcStats } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './ibcTableContainer'

const IbcTableLoader: FC<Props> = async props => {
    const stats = await getIbcStats()

    if (!stats) {
        notFound()
    }

    return <IbcTable stats={stats} {...props} />
}

export default IbcTableLoader

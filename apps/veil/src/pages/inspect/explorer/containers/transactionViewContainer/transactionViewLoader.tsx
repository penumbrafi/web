// istanbul ignore file
import { notFound } from 'next/navigation'
import { FC } from 'react'
import { TransactionView } from '@/pages/inspect/explorer/components'
import { getTransaction } from '@/pages/inspect/explorer/lib/data'
import type { Props } from './transactionViewContainer'

const TransactionViewLoader: FC<Props> = async ({
    transactionHash,
    ...props
}) => {
    const transaction = await getTransaction(transactionHash)

    if (!transaction) {
        notFound()
    }

    return <TransactionView transaction={transaction} {...props} />
}

export default TransactionViewLoader

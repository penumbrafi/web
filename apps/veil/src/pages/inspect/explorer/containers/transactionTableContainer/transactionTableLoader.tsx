// istanbul ignore file
import { FC } from 'react'
import { getTransactions } from '@/pages/inspect/explorer/lib/data'
import GraphqlClientProvider from '@/pages/inspect/explorer/lib/graphql/graphqlClientProvider'
import type { Props } from './transactionTableContainer'
import TransactionTableUpdater from './transactionTableUpdater'

const TransactionTableLoader: FC<Props> = async props => {
    const { total, transactions } = await getTransactions(
        props.limit,
        props.filter
    )

    return (
        <GraphqlClientProvider>
            <TransactionTableUpdater
                total={total}
                transactions={transactions}
                {...props}
            />
        </GraphqlClientProvider>
    )
}

export default TransactionTableLoader

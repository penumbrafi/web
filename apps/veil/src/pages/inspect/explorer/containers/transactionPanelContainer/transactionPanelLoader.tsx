// istanbul ignore file
import { FC } from 'react'
import { getStats } from '@/pages/inspect/explorer/lib/data'
import GraphqlClientProvider from '@/pages/inspect/explorer/lib/graphql/graphqlClientProvider'
import type { Props } from './transactionPanelContainer'
import TransactionPanelUpdater from './transactionPanelUpdater'

const TransactionPanelLoader: FC<Props> = async props => {
    const stats = await getStats()

    return (
        <GraphqlClientProvider>
            <TransactionPanelUpdater
                number={stats?.totalTransactionsCount ?? 0}
                {...props}
            />
        </GraphqlClientProvider>
    )
}

export default TransactionPanelLoader

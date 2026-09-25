// istanbul ignore file
import { notFound } from 'next/navigation'
import { FC } from 'react'
import { getChainParameters } from '@/pages/inspect/explorer/lib/data'
import GraphqlClientProvider from '@/pages/inspect/explorer/lib/graphql/graphqlClientProvider'
import type { Props } from './chainParametersContainer'
import ChainParametersUpdater from './chainParametersUpdater'

const ChainParametersLoader: FC<Props> = async props => {
    const parameters = await getChainParameters()

    if (!parameters) {
        notFound()
    }

    return (
        <GraphqlClientProvider>
            <ChainParametersUpdater {...props} parameters={parameters} />
        </GraphqlClientProvider>
    )
}

export default ChainParametersLoader

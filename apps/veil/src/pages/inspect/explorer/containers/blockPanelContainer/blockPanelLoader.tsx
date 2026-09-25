// istanbul ignore file
import { FC } from 'react'
import { getBlocks } from '@/pages/inspect/explorer/lib/data'
import GraphqlClientProvider from '@/pages/inspect/explorer/lib/graphql/graphqlClientProvider'
import type { Props } from './blockPanelContainer'
import BlockPanelUpdater from './blockPanelUpdater'

const BlockPanelLoader: FC<Props> = async props => {
    const { blocks } = await getBlocks({ length: 1 })

    return (
        <GraphqlClientProvider>
            <BlockPanelUpdater blockHeight={blocks[0]?.height} {...props} />
        </GraphqlClientProvider>
    )
}

export default BlockPanelLoader

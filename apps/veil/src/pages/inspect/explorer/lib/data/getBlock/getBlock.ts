import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import createGraphqlClient from '@/pages/inspect/explorer/lib/graphql/createGraphqlClient'
import { BlockQuery, BlockQueryVariables } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { blockQuery } from '@/pages/inspect/explorer/lib/graphql/queries'
import { ActionType, TransformedBlockFragment } from '@/pages/inspect/explorer/lib/types'
import { decodeTransaction, findPrimaryAction } from '@/pages/inspect/explorer/lib/utils'
import { asRecord, asTime, sortedEvents } from '@/pages/inspect/explorer/lib/utils/json'

const getBlock = async (
    height: number
): Promise<null | TransformedBlockFragment | undefined> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<BlockQuery, BlockQueryVariables>(blockQuery, { height })
        .toPromise()

    if (result.error) {
        throw result.error
    } else if (!result.data?.block) {
        return
    }

    let date = dayjs(asTime(result.data.block.createdAt))
    const raw = asRecord(result.data.block.rawJson)

    return {
        height: result.data.block.height,
        rawJson: {
            height: raw['height'],
            chain_id: raw['chain_id'],
            timestamp: raw['timestamp'],
            transactions: raw['transactions'],
            events: sortedEvents(raw['events']),
        },
        timestamp: date.valueOf(),
        transactions: result.data.block.transactions.map(transaction => {
            date = dayjs(asTime(transaction.block.createdAt))
            let primaryAction: ActionType | undefined
            let actionCount: number | undefined

            try {
                const decoded = decodeTransaction(transaction.raw)
                primaryAction = findPrimaryAction(decoded)
                actionCount = decoded.body?.actions.length
            } catch (e) {
                // istanbul ignore next
                console.error(e)
            }

            return {
                actionCount: actionCount ?? 0,
                blockHeight: height,
                hash: transaction.hash.toLowerCase(),
                primaryAction,
                raw: transaction.raw,
                status: transaction.ibcStatus,
                timestamp: dayjs(asTime(transaction.block.createdAt)).valueOf(),
            }
        }),
    }
}

export default getBlock

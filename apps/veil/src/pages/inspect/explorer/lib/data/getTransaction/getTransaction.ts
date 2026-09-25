import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import { ActionType, TransformedTransactionFragment } from '@/pages/inspect/explorer/lib/types'
import { decodeTransaction, findPrimaryAction } from '@/pages/inspect/explorer/lib/utils'
import { asRecord, asTime, sortedEvents } from '@/pages/inspect/explorer/lib/utils/json'
import createGraphqlClient from '../../graphql/createGraphqlClient'
import {
    TransactionQuery,
    TransactionQueryVariables,
} from '../../graphql/generated/types'
import { transactionQuery } from '../../graphql/queries'

const getTransaction = async (
    hash: string
): Promise<null | TransformedTransactionFragment | undefined> => {
    const graphqlClient = createGraphqlClient()

    const result = await graphqlClient
        .query<
            TransactionQuery,
            TransactionQueryVariables
        >(transactionQuery, { hash: hash.toUpperCase() })
        .toPromise()

    if (result.error) {
        throw result.error
    } else if (!result.data?.transaction) {
        return
    }

    let primaryAction: ActionType | undefined
    let actionCount: number | undefined
    let memo: boolean | undefined

    try {
        const decoded = decodeTransaction(result.data.transaction.raw)
        primaryAction = findPrimaryAction(decoded)
        actionCount = decoded.body?.actions.length
        memo = Boolean(decoded.body?.memo)
    } catch (e) {
        // istanbul ignore next
        console.error(e)
    }

    const raw = asRecord(result.data.transaction.rawJson)
    const view = asRecord(raw['transaction_view'])
    const body = asRecord(view['body'])

    return {
        actionCount: actionCount ?? 0,
        blockHeight: result.data.transaction.block.height,
        chainId: result.data.transaction.body.parameters.chainId,
        fee: Number(result.data.transaction.body.parameters.fee.amount),
        hash: result.data.transaction.hash.toLowerCase(),
        memo: memo ?? false,
        primaryAction,
        raw: result.data.transaction.raw,
        rawJson: {
            hash: raw['hash'],
            block_height: raw['block_height'],
            index: raw['index'],
            timestamp: raw['timestamp'],
            transaction_view: {
                body: {
                    actions: body['actions'],
                    transactionParameters: body['transactionParameters'],
                    detectionData: body['detectionData'],
                    memo: body['memo'],
                },
                bindingSig: view['bindingSig'],
                anchor: view['anchor'],
            },
            events: sortedEvents(raw['events']),
        },
        timestamp: dayjs(asTime(result.data.transaction.block.createdAt)).valueOf(),
    }
}

export default getTransaction

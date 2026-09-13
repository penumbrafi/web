// istanbul ignore file
'use client'

import { FC, useEffect, useRef, useState } from 'react'
import { useClient } from 'urql'
import { pipe, subscribe } from 'wonka'
import { Pagination, ResultCount, TransactionTable } from '@/pages/inspect/explorer/components'
import { animationFrameMs } from '@/pages/inspect/explorer/lib/constants'
import {
    IbcStatus,
    TransactionUpdateSubscription,
    TransactionUpdateSubscriptionVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import transactionSubscription from '@/pages/inspect/explorer/lib/graphql/subscriptions/transactionSubscription.graphql'
import { TransformedPartialTransactionFragment } from '@/pages/inspect/explorer/lib/types'
import { decodeTransaction, findPrimaryAction } from '@/pages/inspect/explorer/lib/utils'
import { Props as TransactionTableContainerProps } from './transactionTableContainer'

interface Props extends TransactionTableContainerProps {
    total: number
    transactions?: TransformedPartialTransactionFragment[]
}

const TransactionTableUpdater: FC<Props> = ({
    filter,
    limit,
    pagination,
    subscription,
    total,
    ...props
}) => {
    const client = useClient()
    const queueRef = useRef<TransformedPartialTransactionFragment[]>([])
    const animationFrameRef = useRef<number>(undefined)
    const updateTimestampRef = useRef(0)
    const [transactions, setTransactions] = useState(props.transactions ?? [])

    const hashesRef = useRef(
        new Set(transactions.map(transaction => transaction.hash))
    )

    useEffect(() => {
        if (!subscription) {
            return
        }

        const source = client.subscription<
            TransactionUpdateSubscription,
            TransactionUpdateSubscriptionVariables
        >(transactionSubscription, {})

        const { unsubscribe } = pipe(
            source,
            subscribe(result => {
                const transaction = result.data?.latestTransactions

                if (!transaction) {
                    return
                }

                const hash = transaction?.hash.toLowerCase()

                if (hashesRef.current.has(hash)) {
                    return
                }

                let primaryAction
                let actionCount

                try {
                    const decoded = decodeTransaction(transaction.raw)
                    primaryAction = findPrimaryAction(decoded)
                    actionCount = decoded.body?.actions.length
                } catch (e) {
                    // istanbul ignore next
                    console.error(e)
                }

                hashesRef.current.add(hash)

                queueRef.current.push({
                    actionCount: actionCount ?? 0,
                    blockHeight: transaction.id,
                    hash,
                    primaryAction,
                    raw: transaction.raw,
                    status: IbcStatus.Completed, // FIXME: Query ibcStatus
                    // Subscription payload has no timestamp; wall clock at the
                    // moment the event lands is within a couple of seconds of
                    // block time. Beats epoch-0 rendering as "57 years ago".
                    // FIXME: expose Block.createdAt on the subscription type.
                    timestamp: Date.now(),
                })
            })
        )

        return () => unsubscribe()
    }, [client, subscription])

    useEffect(() => {
        const animationLoop = () => {
            if (queueRef.current.length) {
                const now = performance.now()

                if (now - updateTimestampRef.current >= animationFrameMs) {
                    const transaction = queueRef.current.shift()

                    if (transaction) {
                        setTransactions(prev =>
                            [transaction, ...prev].slice(0, 10)
                        )

                        updateTimestampRef.current = now
                    }
                }
            }

            animationFrameRef.current = requestAnimationFrame(animationLoop)
        }

        animationFrameRef.current = requestAnimationFrame(animationLoop)

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [])

    const page = (limit.offset ?? 0) / limit.length + 1
    const totalPages = Math.ceil(total / limit.length)

    return (
        <TransactionTable
            {...props}
            footer={
                pagination ? (
                    <div className="flex flex-col items-center gap-2">
                        <Pagination page={page} totalPages={totalPages} />
                        <ResultCount
                            length={transactions.length}
                            offset={limit.offset}
                            total={total}
                        />
                    </div>
                ) : undefined
            }
            transactions={transactions}
        />
    )
}

export default TransactionTableUpdater

// istanbul ignore file
'use client'

import { FC, useEffect, useRef, useState } from 'react'
import { useClient } from 'urql'
import { BlockTable, Pagination, ResultCount } from '@/pages/inspect/explorer/components'
import { animationFrameMs } from '@/pages/inspect/explorer/lib/constants'
import dayjs from '@/pages/inspect/explorer/lib/dayjs'
import {
    BlocksQuery,
    BlocksQueryVariables,
} from '@/pages/inspect/explorer/lib/graphql/generated/types'
import blocksQuery from '@/pages/inspect/explorer/lib/graphql/queries/blocksQuery'
import { subscribeToNewBlocks } from '@/shared/cometbft/subscribe-new-blocks'
import { TransformedPartialBlockFragment } from '@/pages/inspect/explorer/lib/types'
import { Props as BlockTableContainerProps } from './blockTableContainer'

const COMETBFT_WS_URL =
    process.env['NEXT_PUBLIC_COMETBFT_WS_URL'] ?? 'wss://penumbra.rotko.net/websocket'

interface Props extends BlockTableContainerProps {
    blocks?: TransformedPartialBlockFragment[]
    total: number
}

const BlockTableUpdater: FC<Props> = ({
    filter,
    limit,
    pagination,
    subscription,
    total,
    ...props
}) => {
    const client = useClient()
    const queueRef = useRef<TransformedPartialBlockFragment[]>([])
    const animationFrameRef = useRef<number>(undefined)
    const updateTimestampRef = useRef(0)
    // Schedule the animation loop only when there's something to do — the
    // previous form ran rAF forever (60 callbacks/sec) even on a quiet
    // chain with nothing to drain. kickAnimationLoop is set inside the
    // mount-effect below; the subscription handler calls it after each
    // queued block to start (or keep) the loop, and the loop self-stops
    // when the queue is drained.
    const kickAnimationLoopRef = useRef<() => void>(() => {})
    const kickAnimationLoop = () => kickAnimationLoopRef.current()
    const [blocks, setBlocks] = useState(props.blocks ?? [])

    const blockHeightsRef = useRef(
        new Set(props.blocks?.map(block => block.height))
    )

    // Track latest blocks via a ref so the subscription effect can read
    // 'knownTop' without listing 'blocks' as a dep — putting blocks in
    // the deps tears the websocket down on every state update, and the
    // replay event from the new stream gets dropped as a duplicate, so
    // the table stops live-updating after the first block.
    const blocksRef = useRef<TransformedPartialBlockFragment[]>(blocks)
    useEffect(() => {
        blocksRef.current = blocks
    }, [blocks])

    useEffect(() => {
        if (!subscription) {
            return
        }

        // Live block heads come straight from CometBFT's RPC WebSocket
        // rather than through the indexer's GraphQL subscription. The
        // chain is the source of truth and a single WS hop away; the
        // indexer path adds a proxy, a process, and a pg notification
        // fan-out, each a fresh way for "live blocks" to silently stall.
        //
        // The indexer is still in charge of the initial paint and the
        // safety-net refill below — cometbft only knows the head it
        // sees, not the historical paginated window.

        // If a block arrives non-contiguously (we missed one), refill
        // the visible window from the indexer in one round-trip so the
        // panel stays gap-free.
        //
        // The indexer trails cometbft's tip by a few blocks (cometindex
        // lag). If refill did a wholesale replace of state with the
        // indexer's window, every fresher WS head we already accepted
        // would be clobbered on the next 15s poll — pinning the panel
        // to the indexer's stale tip. So merge: keep any WS-delivered
        // heads (rendered OR queued) that outrun the indexer, union
        // with the indexer's window, dedupe, sort desc, top 10.
        const refillVisibleWindow = async () => {
            try {
                const result = await client
                    .query<BlocksQuery, BlocksQueryVariables>(
                        blocksQuery,
                        { limit: { length: 10, offset: 0 } },
                        { requestPolicy: 'network-only' },
                    )
                    .toPromise()
                const fresh = result.data?.blocks?.items ?? []
                if (!fresh.length) {return}
                const transformed = fresh.map(b => ({
                    height: b.height,
                    timestamp: dayjs(b.createdAt).valueOf(),
                    transactionsCount: b.transactionsCount,
                }))
                const byHeight = new Map<number, TransformedPartialBlockFragment>()
                for (const b of transformed) {byHeight.set(b.height, b)}
                for (const b of blocksRef.current) {if (!byHeight.has(b.height)) {byHeight.set(b.height, b)}}
                for (const b of queueRef.current) {if (!byHeight.has(b.height)) {byHeight.set(b.height, b)}}
                const merged = [...byHeight.values()]
                    .sort((a, b) => b.height - a.height)
                    .slice(0, 10)
                blockHeightsRef.current = new Set(merged.map(b => b.height))
                queueRef.current = []
                setBlocks(merged)
            } catch {
                // ignore — next sub event or poll will retry
            }
        }

        const unsubscribe = subscribeToNewBlocks({
            url: COMETBFT_WS_URL,
            onBlock: block => {
                if (blockHeightsRef.current.has(block.height)) {
                    return
                }

                // Detect a gap: incoming height should be exactly one above
                // whichever height we currently consider "top" (queued or
                // rendered). If it's farther, refill the window.
                const knownTop = Math.max(
                    blocksRef.current[0]?.height ?? 0,
                    queueRef.current[queueRef.current.length - 1]?.height ?? 0,
                )
                // Gap detected: kick a background refill to fetch the
                // missed intermediate heights, but still enqueue this
                // head. Dropping it here is what pinned the panel to
                // the indexer's stale tip — the indexer trails, so on
                // first paint 'knownTop' is behind and every WS block
                // looks like a gap.
                if (knownTop > 0 && block.height - knownTop > 1) {
                    void refillVisibleWindow()
                }

                blockHeightsRef.current.add(block.height)
                queueRef.current.push({
                    height: block.height,
                    timestamp: dayjs(block.time).valueOf(),
                    transactionsCount: block.txCount,
                })
                kickAnimationLoop()
            },
        })

        // Refill on visibility-change wake — closes the gap from the
        // common "tab was backgrounded for 30 minutes" failure mode.
        const onVisible = () => {
            if (document.visibilityState === 'visible') {void refillVisibleWindow()}
        }
        document.addEventListener('visibilitychange', onVisible)

        // Hard-poll every 15s as a safety net for the case where the WS
        // is silently broken (e.g. middlebox idle timeout, NAT rebind,
        // proxy hiccup). Cheap — one 10-row indexer read.
        const pollId = window.setInterval(() => {
            void refillVisibleWindow()
        }, 15_000)

        return () => {
            unsubscribe()
            window.clearInterval(pollId)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [client, subscription])

    useEffect(() => {
        const animationLoop = () => {
            animationFrameRef.current = undefined
            if (!queueRef.current.length) {
                return
            }
            const now = performance.now()
            if (now - updateTimestampRef.current >= animationFrameMs) {
                const block = queueRef.current.shift()
                if (block) {
                    setBlocks(prev => [block, ...prev].slice(0, 10))
                    updateTimestampRef.current = now
                }
            }
            // Re-arm only if there's still work — either queued items not
            // yet drained, or we're still inside the throttle window and
            // need to wake up to drain them.
            if (queueRef.current.length) {
                animationFrameRef.current = requestAnimationFrame(animationLoop)
            }
        }

        // Idempotent kick — the subscription handler calls this after each
        // pushed block to (re)start the loop. No-op if already scheduled.
        kickAnimationLoopRef.current = () => {
            if (animationFrameRef.current !== undefined) {return}
            animationFrameRef.current = requestAnimationFrame(animationLoop)
        }

        return () => {
            kickAnimationLoopRef.current = () => {}
            if (animationFrameRef.current !== undefined) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [])

    const page = (limit.offset ?? 0) / limit.length + 1
    const totalPages = Math.ceil(total / limit.length)

    return (
        <BlockTable
            {...props}
            blocks={blocks}
            footer={
                pagination ? (
                    <div className="flex flex-col items-center gap-2">
                        <Pagination page={page} totalPages={totalPages} />
                        <ResultCount
                            length={blocks.length}
                            offset={limit.offset}
                            total={total}
                        />
                    </div>
                ) : undefined
            }
        />
    )
}

export default BlockTableUpdater

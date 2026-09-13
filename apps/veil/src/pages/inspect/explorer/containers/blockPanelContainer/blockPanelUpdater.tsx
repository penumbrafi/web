// istanbul ignore file
'use client'

import { FC, useEffect, useRef, useState } from 'react'
import { BlockPanel } from '@/pages/inspect/explorer/components'
import { animationFrameMs } from '@/pages/inspect/explorer/lib/constants'
import { subscribeToNewBlocks } from '@/shared/cometbft/subscribe-new-blocks'
import { Props as BlockPanelContainerProps } from './blockPanelContainer'

const COMETBFT_WS_URL =
    process.env['NEXT_PUBLIC_COMETBFT_WS_URL'] ?? 'wss://penumbra.rotko.net/websocket'

interface Props extends BlockPanelContainerProps {
    blockHeight?: number
}

const BlockPanelUpdater: FC<Props> = props => {
    const queueRef = useRef<number[]>([])
    const animationFrameRef = useRef<number>(undefined)
    const updateTimestampRef = useRef(0)
    const [reindexing, setReindexing] = useState(false)
    const [blockHeight, setBlockHeight] = useState(props.blockHeight)

    // Subscribe to CometBFT directly (same source the block table uses)
    // rather than the indexer's GraphQL subscription — the indexer trails
    // tip by a few blocks so the panel used to sit behind the table right
    // next to it.
    useEffect(() => {
        const unsubscribe = subscribeToNewBlocks({
            url: COMETBFT_WS_URL,
            onBlock: block => {
                queueRef.current.push(block.height)
                setReindexing(queueRef.current.length > 2)
            },
        })
        return () => unsubscribe()
    }, [])

    useEffect(() => {
        const animationLoop = () => {
            if (queueRef.current.length > 0) {
                const now = performance.now()

                if (now - updateTimestampRef.current >= animationFrameMs) {
                    const height = queueRef.current.shift()

                    if (height) {
                        setBlockHeight(height)
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

    return (
        <BlockPanel
            {...props}
            blockHeight={blockHeight}
            reindexing={reindexing}
        />
    )
}

export default BlockPanelUpdater

// istanbul ignore file
import { FC } from 'react'
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb'
import { ChainRegistryClient } from '@penumbra-labs/registry'
import { Surface } from '@/pages/inspect/explorer/components'
import getTradingPairLiquidity from '@/pages/inspect/explorer/lib/data/getTradingPairLiquidity'
import getTradingVolume24h from '@/pages/inspect/explorer/lib/data/getTradingVolume24h'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import { Props } from './dexMarketOverviewContainer'

function truncateAssetId(id: string): string {
    if (id.length > 16) return `${id.slice(0, 8)}...${id.slice(-6)}`
    return id
}

function displayExponent(metadata: Metadata | undefined): number {
    if (!metadata) return 0
    const unit = metadata.denomUnits.find(d => d.denom === metadata.display)
    return unit?.exponent ?? 0
}

function assetLabel(id: string, metadata: Metadata | undefined): string {
    return metadata?.symbol || truncateAssetId(id)
}

function formatDisplayAmount(raw: string, exponent: number): string {
    const scaled = Number(raw) / Math.pow(10, exponent)
    if (!Number.isFinite(scaled) || scaled === 0) return '0'
    if (scaled >= 1e12) return `${(scaled / 1e12).toFixed(2)}T`
    if (scaled >= 1e9) return `${(scaled / 1e9).toFixed(2)}B`
    if (scaled >= 1e6) return `${(scaled / 1e6).toFixed(2)}M`
    if (scaled >= 1e3) return `${(scaled / 1e3).toFixed(1)}K`
    if (scaled >= 1) return scaled.toLocaleString('en-US', { maximumFractionDigits: 2 })
    return scaled.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function b64ToBytes(s: string): Uint8Array {
    return new Uint8Array(Buffer.from(s, 'base64'))
}

const DexMarketOverviewLoader: FC<Props> = async props => {
    const [pairs, volumes] = await Promise.all([
        getTradingPairLiquidity(10),
        getTradingVolume24h(10),
    ])

    // Resolve base64 asset IDs to registry symbols so the pair column shows
    // "UM / USDC" instead of "drPksQaB...7cjQs= / KeqcLzNx...ypahA=", and so
    // reserves can be scaled to display units (raw base amounts are otherwise
    // orders of magnitude off and read as absurd M/B totals).
    const chainId = process.env['PENUMBRA_CHAIN_ID']
    let metadataByB64: Map<string, Metadata> = new Map()
    if (chainId) {
        try {
            const client = new ChainRegistryClient()
            const registry = await client.remote.get(chainId)
            for (const asset of registry.getAllAssets()) {
                const inner = asset.penumbraAssetId?.inner
                if (!inner) continue
                metadataByB64.set(
                    Buffer.from(inner).toString('base64'),
                    asset
                )
            }
        } catch (e) {
            console.warn('[dex-overview] failed to load registry:', e)
        }
    }

    const lookup = (b64: string): Metadata | undefined => {
        const hit = metadataByB64.get(b64)
        if (hit) return hit
        try {
            return metadataByB64.get(
                Buffer.from(b64ToBytes(b64)).toString('base64')
            )
        } catch {
            return undefined
        }
    }

    const hasPairs = pairs.length > 0
    const hasVolumes = volumes.length > 0

    if (!hasPairs && !hasVolumes) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">Market overview</h2>
                </header>
                <p className="text-text-secondary">
                    No market data available yet.
                </p>
            </Surface>
        )
    }

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header>
                <h2 className="text-2xl font-medium">Market overview</h2>
            </header>

            {hasVolumes && (
                <div>
                    <h3 className="text-text-secondary mb-3 text-sm font-medium">
                        24h trading volume
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-border-secondary border-b">
                                    <th className="pr-4 pb-2 text-left font-medium">
                                        Asset
                                    </th>
                                    <th className="pr-4 pb-2 text-right font-medium">
                                        Volume
                                    </th>
                                    <th className="pb-2 text-right font-medium">
                                        Swaps
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {volumes.map(v => {
                                    const meta = lookup(v.assetId)
                                    return (
                                        <tr
                                            key={v.assetId}
                                            className="border-border-secondary border-b"
                                        >
                                            <td className="py-2 pr-4 text-xs">
                                                {meta?.symbol ? (
                                                    <span>{meta.symbol}</span>
                                                ) : (
                                                    <span className="font-mono">
                                                        {truncateAssetId(
                                                            v.assetId
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {formatDisplayAmount(
                                                    v.volume24h,
                                                    displayExponent(meta)
                                                )}
                                            </td>
                                            <td className="py-2 text-right">
                                                {v.swapCount24h.toLocaleString('en-US')}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {hasPairs && (
                <div>
                    <h3 className="text-text-secondary mb-3 text-sm font-medium">
                        Top trading pairs by liquidity
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-border-secondary border-b">
                                    <th className="pr-4 pb-2 text-left font-medium">
                                        Pair
                                    </th>
                                    <th className="pr-4 pb-2 text-right font-medium">
                                        Positions
                                    </th>
                                    <th className="pr-4 pb-2 text-right font-medium">
                                        Reserves 1
                                    </th>
                                    <th className="pr-4 pb-2 text-right font-medium">
                                        Reserves 2
                                    </th>
                                    <th className="pb-2 text-right font-medium">
                                        Avg fee
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pairs.map((p, i) => {
                                    const m1 = lookup(p.tradingPairAsset1)
                                    const m2 = lookup(p.tradingPairAsset2)
                                    const label1 = assetLabel(
                                        p.tradingPairAsset1,
                                        m1
                                    )
                                    const label2 = assetLabel(
                                        p.tradingPairAsset2,
                                        m2
                                    )
                                    const bothResolved = Boolean(m1 && m2)
                                    return (
                                        <tr
                                            key={i}
                                            className="border-border-secondary border-b"
                                        >
                                            <td
                                                className={classNames(
                                                    'py-2 pr-4 text-xs',
                                                    bothResolved
                                                        ? ''
                                                        : 'font-mono'
                                                )}
                                            >
                                                {label1} / {label2}
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                {p.activePositions.toLocaleString('en-US')}
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {formatDisplayAmount(
                                                    p.totalReserves1,
                                                    displayExponent(m1)
                                                )}{' '}
                                                {m1?.symbol ?? ''}
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {formatDisplayAmount(
                                                    p.totalReserves2,
                                                    displayExponent(m2)
                                                )}{' '}
                                                {m2?.symbol ?? ''}
                                            </td>
                                            <td className="py-2 text-right">
                                                {p.avgFeePercentage.toFixed(2)}%
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </Surface>
    )
}

export default DexMarketOverviewLoader

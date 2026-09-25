// istanbul ignore file
import { FC } from 'react'
import { Surface } from '@/pages/inspect/explorer/components'
import getRecentSwapPrices from '@/pages/inspect/explorer/lib/data/getRecentSwapPrices'
import { classNames } from '@/pages/inspect/explorer/lib/utils'
import type { Props } from './dexPriceTableContainer'

function truncateAssetId(id: string): string {
    if (id.length > 16) {return `${id.slice(0, 8)}...${id.slice(-6)}`}
    return id
}

function formatPrice(price: number): string {
    if (price === 0) {return '0'}
    if (price >= 1_000_000) {return price.toExponential(4)}
    if (price >= 1) {return price.toFixed(4)}
    if (price >= 0.0001) {return price.toFixed(6)}
    return price.toExponential(4)
}

const DexPriceTableLoader: FC<Props> = async props => {
    const prices = await getRecentSwapPrices(20)

    if (prices.length === 0) {
        return (
            <Surface
                as="section"
                className={classNames(
                    'flex flex-col gap-6 p-6',
                    props.className
                )}
            >
                <header>
                    <h2 className="text-2xl font-medium">Recent prices</h2>
                </header>
                <p className="text-text-secondary">
                    No recent swap price data available. Prices are derived from
                    swaps in the last hour.
                </p>
            </Surface>
        )
    }

    return (
        <Surface
            as="section"
            className={classNames('flex flex-col gap-6 p-6', props.className)}
        >
            <header className="flex items-baseline justify-between">
                <h2 className="text-2xl font-medium">Recent prices</h2>
                <div className="text-sm text-text-secondary">
                    Derived from last hour of swaps
                </div>
            </header>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-border-secondary border-b">
                            <th className="pr-4 pb-2 text-left font-medium">
                                Input
                            </th>
                            <th className="pr-4 pb-2 text-left font-medium">
                                Output
                            </th>
                            <th className="pr-4 pb-2 text-right font-medium">
                                Avg price
                            </th>
                            <th className="pr-4 pb-2 text-right font-medium">
                                Swaps
                            </th>
                            <th className="pb-2 text-right font-medium">
                                Last swap
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {prices.map((p, i) => (
                            <tr
                                key={i}
                                className="border-border-secondary border-b"
                            >
                                <td className="py-2 pr-4 font-mono text-xs">
                                    {truncateAssetId(p.inputAssetId)}
                                </td>
                                <td className="py-2 pr-4 font-mono text-xs">
                                    {truncateAssetId(p.outputAssetId)}
                                </td>
                                <td className="py-2 pr-4 text-right font-mono">
                                    {formatPrice(p.avgPrice)}
                                </td>
                                <td className="py-2 pr-4 text-right">
                                    {p.swapCount.toLocaleString('en-US')}
                                </td>
                                <td className="py-2 text-right text-text-secondary">
                                    {p.latestSwap
                                        ? new Date(
                                              p.latestSwap
                                          ).toLocaleTimeString('en-US', { timeZone: 'UTC' })
                                        : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Surface>
    )
}

export default DexPriceTableLoader

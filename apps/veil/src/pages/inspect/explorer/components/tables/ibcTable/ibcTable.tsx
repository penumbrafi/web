import Link from 'next/link'
import { FC, useMemo } from 'react'
import { describeClient } from '@/pages/inspect/explorer/lib/ibc'
import { placeholderAvatarImage } from '@/pages/inspect/explorer/lib/images'
import { TransformedIbcStats } from '@/pages/inspect/explorer/lib/types'
import { classNames, formatNumber } from '@/pages/inspect/explorer/lib/utils'
import Avatar from '../../avatar'
import EmptyState from '../../emptyState'
import ClientStatusPill from '../../pills/clientStatusPill'
import TimeAgo from '../../timeAgo'
import { Table, TableCell, TableProps, TableRow } from '../table'

export interface Props extends Omit<TableProps, 'children'> {
    stats: TransformedIbcStats[]
}

const IbcTable: FC<Props> = props => {
    const clients = useMemo(
        () =>
            props.stats.map(stats => ({
                ...stats,
                ...describeClient(stats.id, stats.counterpartyChainId),
            })),
        [props.stats]
    )

    return (
        <Table className={props.className}>
            <thead>
                <TableRow>
                    <TableCell header>Name</TableCell>
                    <TableCell header>Client status</TableCell>
                    <TableCell header>Client ID</TableCell>
                    <TableCell header>Channel ID</TableCell>
                    <TableCell header>Last tx time</TableCell>
                    <TableCell header>Total tx count</TableCell>
                </TableRow>
            </thead>
            <tbody>
                {clients.length ? (
                    clients.map(client => (
                        <TableRow key={client.id} href={`/explore/ibc/${client.slug}`}>
                            <TableCell className="h-20">
                                <Avatar
                                    alt={client.name}
                                    fallback={placeholderAvatarImage}
                                    src={client.image}
                                />
                                <span className="inline-flex flex-col">
                                    <Link
                                        className={classNames(
                                            'font-default text-lg font-normal'
                                        )}
                                        href={`/explore/ibc/${client.slug}`}
                                    >
                                        {client.name}
                                    </Link>
                                    {client.chainId !== client.id && (
                                        <span
                                            className={classNames(
                                                'text-text-secondary text-xs',
                                                'font-medium'
                                            )}
                                        >
                                            {client.chainId}
                                        </span>
                                    )}
                                </span>
                            </TableCell>
                            <TableCell className="h-20">
                                <ClientStatusPill status={client.status} />
                            </TableCell>
                            <TableCell className="h-20">
                                <span className="text-base font-normal">
                                    {client.id}
                                </span>
                            </TableCell>
                            <TableCell className="h-20">
                                {client.channelId && (
                                    <span className="text-base font-normal">
                                        {client.channelId}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="h-20">
                                <span className="text-base font-normal">
                                    <TimeAgo timestamp={client.timestamp} />
                                </span>
                            </TableCell>
                            <TableCell className="h-20">
                                <span className="text-base font-normal">
                                    {formatNumber(client.totalTxCount)}
                                </span>
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell className="h-20" colSpan={6}>
                            <EmptyState>No clients found</EmptyState>
                        </TableCell>
                    </TableRow>
                )}
            </tbody>
        </Table>
    )
}

export default IbcTable

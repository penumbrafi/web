import Link from 'next/link'
import { FC, useMemo } from 'react'
import { describeClient } from '@/pages/inspect/explorer/lib/ibc'
import { ClientFilter, FILTER_STATUS } from '@/pages/inspect/explorer/lib/ibc/client-health'
import { placeholderAvatarImage } from '@/pages/inspect/explorer/lib/images'
import { TransformedIbcStats } from '@/pages/inspect/explorer/lib/types'
import { classNames, formatNumber } from '@/pages/inspect/explorer/lib/utils'
import Avatar from '../../avatar'
import EmptyState from '../../emptyState'
import ClientStatusPill from '../../pills/clientStatusPill'
import TimeAgo from '../../timeAgo'
import TimeUntil from '../../timeUntil'
import { Table, TableCell, TableProps, TableRow } from '../table'

export interface Props extends Omit<TableProps, 'children'> {
    stats: TransformedIbcStats[]
    /** Tab the page selected; defaults to the live clients. */
    filter?: ClientFilter
}

const EMPTY_TEXT: Record<ClientFilter, string> = {
    open: 'No open clients',
    expired: 'No expired clients',
    frozen: 'No frozen clients',
    all: 'No clients found',
}

const IbcTable: FC<Props> = props => {
    const filter = props.filter ?? 'open'
    const status = FILTER_STATUS[filter]

    const clients = useMemo(
        () =>
            props.stats
                .filter(stats => status === undefined || stats.status === status)
                .map(stats => ({
                    ...stats,
                    ...describeClient(stats.id, stats.counterpartyChainId),
                })),
        [props.stats, status]
    )

    return (
        <Table className={props.className} header={props.header}>
            <thead>
                <TableRow>
                    <TableCell header>Name</TableCell>
                    <TableCell header>Client status</TableCell>
                    <TableCell header>Client ID</TableCell>
                    <TableCell header>Channel ID</TableCell>
                    <TableCell header>Expires in</TableCell>
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
                                {client.expiresAt === undefined ? (
                                    <span className="text-base font-normal text-text-secondary">
                                        —
                                    </span>
                                ) : (
                                    <span className="text-base font-normal">
                                        <TimeUntil timestamp={client.expiresAt} />
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
                        <TableCell className="h-20" colSpan={7}>
                            <EmptyState>{EMPTY_TEXT[filter]}</EmptyState>
                        </TableCell>
                    </TableRow>
                )}
            </tbody>
        </Table>
    )
}

export default IbcTable

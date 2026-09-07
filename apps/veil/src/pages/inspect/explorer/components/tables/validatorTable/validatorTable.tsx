import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'
import { ValidatorsQuery } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { penumbraImage, placeholderAvatarImage } from '@/pages/inspect/explorer/lib/images'
import { classNames, formatNumber, shortenHash } from '@/pages/inspect/explorer/lib/utils'
import { validatorImages } from '@/pages/inspect/explorer/lib/validators'
import { RowStakeActions } from '@/pages/inspect/explorer/ui/row-stake-actions'
import Avatar from '../../avatar'
import EmptyState from '../../emptyState'
import SortableHeader from '../../sortableHeader'
import ValidatorStateBonding from '../../validatorStateBonding'
import { Table, TableCell, TableProps, TableRow } from '../table'

export type SortKey =
    | 'commission'
    | 'growth30d'
    | 'growth7d'
    | 'name'
    | 'power'
    | 'uptime'
export type SortDir = 'asc' | 'desc'

export type ValidatorRow =
    ValidatorsQuery['validatorsHomepage']['validators'][number] & {
        stakeDelta7d?: number
        stakeDelta30d?: number
    }

export interface Props extends Omit<TableProps, 'children'> {
    inactive?: boolean
    sort?: SortKey
    sortDir?: SortDir
    validators: ValidatorRow[]
    /**
     * SSR-rendering limit. By default we render only the top `limit`
     * validators after sorting; the page footer offers a `?all=1`
     * link that lifts the limit. Without this cap the active validator
     * set ships ~1.1MB of HTML on every request, most of it React
     * Flight serialization of rows below the fold.
     */
    limit?: number
}

const toneFor = (value: number): string => {
    if (value > 0) {
        return 'text-success-light'
    }
    if (value < 0) {
        return 'text-destructive-light'
    }
    return 'text-text-secondary'
}

const DeltaCell: FC<{ value: number }> = ({ value }) => (
    <span className={toneFor(value)}>
        {value > 0 ? '+' : ''}
        {formatNumber(value)} UM
    </span>
)

function sortValidators(
    validators: Props['validators'],
    sort?: SortKey,
    dir?: SortDir
): Props['validators'] {
    if (!sort) return validators
    const sorted = [...validators]
    const mul = dir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
        switch (sort) {
            case 'name':
                return mul * (a.name || a.id).localeCompare(b.name || b.id)
            case 'power':
                return mul * (a.votingPower - b.votingPower)
            case 'uptime':
                return mul * ((a.uptime || 0) - (b.uptime || 0))
            case 'commission':
                return mul * (a.commission - b.commission)
            case 'growth7d':
                return mul * ((a.stakeDelta7d ?? 0) - (b.stakeDelta7d ?? 0))
            case 'growth30d':
                return mul * ((a.stakeDelta30d ?? 0) - (b.stakeDelta30d ?? 0))
            default:
                return 0
        }
    })
    return sorted
}

const ValidatorTable: FC<Props> = ({
    inactive,
    sort,
    sortDir,
    validators: rawValidators,
    limit,
    ...props
}) => {
    const sorted = sortValidators(rawValidators, sort, sortDir)
    const validators = limit ? sorted.slice(0, limit) : sorted
    const showDeltaCol = sort === 'growth7d' || sort === 'growth30d'
    const deltaWindow = sort === 'growth30d' ? '30d' : '7d'
    const deltaKey: 'stakeDelta30d' | 'stakeDelta7d' =
        sort === 'growth30d' ? 'stakeDelta30d' : 'stakeDelta7d'
    return (
        <Table {...props}>
            <thead>
                <TableRow>
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="name"
                        >
                            Name
                        </SortableHeader>
                    </TableCell>
                    <TableCell header>Status</TableCell>
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="power"
                        >
                            {inactive ? 'Staked tokens' : 'Voting power'}
                        </SortableHeader>
                    </TableCell>
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="uptime"
                        >
                            Uptime %
                        </SortableHeader>
                    </TableCell>
                    <TableCell header>Defined</TableCell>
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="commission"
                        >
                            Commission
                        </SortableHeader>
                    </TableCell>
                    <TableCell header>Your stake</TableCell>
                    {showDeltaCol && (
                        <TableCell header>
                            <SortableHeader
                                currentSort={sort}
                                direction={sortDir}
                                sortKey={
                                    sort === 'growth30d'
                                        ? 'growth30d'
                                        : 'growth7d'
                                }
                            >
                                Δ {deltaWindow}
                            </SortableHeader>
                        </TableCell>
                    )}
                </TableRow>
            </thead>
            <tbody>
                {validators.length ? (
                    validators.map((validator, i) => (
                        <TableRow key={i} href={`/explore/validators/${encodeURIComponent(validator.id)}`}>
                            <TableCell className="h-15">
                                <Avatar
                                    alt={validator.name || validator.id}
                                    fallback={placeholderAvatarImage}
                                    src={validatorImages[validator.id]}
                                    fallbackLetter
                                />
                                <Link href={`/explore/validators/${encodeURIComponent(validator.id)}`}>
                                    {validator.name ||
                                        shortenHash(validator.id, 19, 'end')}
                                </Link>
                            </TableCell>
                            <TableCell className="h-15">
                                <ValidatorStateBonding
                                    bondingState={validator.bondingState}
                                    state={validator.state}
                                />
                            </TableCell>
                            <TableCell className="h-15">
                                {inactive ? (
                                    <span className="inline-flex items-center gap-1">
                                        <Image
                                            alt="UM"
                                            height={24}
                                            src={penumbraImage}
                                            width={24}
                                        />
                                        <span>
                                            {formatNumber(
                                                validator.votingPower
                                            )}{' '}
                                            UM
                                        </span>
                                    </span>
                                ) : (
                                    <span className="inline-flex flex-col gap-1">
                                        <span className="inline-flex items-center gap-1">
                                            <Image
                                                alt="UM"
                                                height={24}
                                                src={penumbraImage}
                                                width={24}
                                            />
                                            <span>
                                                {formatNumber(
                                                    validator.votingPower
                                                )}{' '}
                                                UM
                                            </span>
                                        </span>
                                        <span className="text-text-secondary ml-7 text-xs">
                                            {validator.votingPowerActivePercentage.toFixed(
                                                2
                                            )}
                                            %
                                        </span>
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="h-15">
                                {typeof validator.uptime === 'number' ? (
                                    <span
                                        className={classNames(
                                            validator.uptime >= 80
                                                ? 'text-success-light'
                                                : validator.uptime > 5
                                                  ? 'text-caution-light'
                                                  : 'text-destructive-light'
                                        )}
                                    >
                                        {validator.uptime.toFixed(2)}%
                                    </span>
                                ) : null}
                            </TableCell>
                            <TableCell className="h-15">
                                {validator.firstSeenTime}
                            </TableCell>
                            <TableCell className="h-15">
                                {validator.commission}%
                            </TableCell>
                            {/* Wallet-gated leaf inside a server-rendered
                                row. Delegating from the list is the whole
                                point of folding staking into Explore. */}
                            <TableCell className="h-15">
                                <RowStakeActions
                                    active={!inactive}
                                    validatorId={validator.id}
                                />
                            </TableCell>
                            {showDeltaCol && (
                                <TableCell className="h-15">
                                    <DeltaCell
                                        value={validator[deltaKey] ?? 0}
                                    />
                                </TableCell>
                            )}
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell
                            className="h-15"
                            colSpan={showDeltaCol ? 8 : 7}
                        >
                            <EmptyState>No validators found</EmptyState>
                        </TableCell>
                    </TableRow>
                )}
            </tbody>
        </Table>
    )
}

export default ValidatorTable

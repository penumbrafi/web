import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'
import { ValidatorsQuery } from '@/pages/inspect/explorer/lib/graphql/generated/types'
import { penumbraImage, placeholderAvatarImage } from '@/pages/inspect/explorer/lib/images'
import { classNames, formatNumber, nonEmpty, shortenHash } from '@/pages/inspect/explorer/lib/utils'
import { validatorImages } from '@/pages/inspect/explorer/lib/validators'
import Avatar from '../../avatar'
import EmptyState from '../../emptyState'
import SortableHeader from '../../sortableHeader'
import ValidatorStateBonding from '../../validatorStateBonding'
import { Table, TableCell, TableProps, TableRow } from '../table'

const uptimeTone = (uptime: number) => {
    if (uptime >= 80) {
        return 'text-success-light'
    }
    return uptime > 5 ? 'text-caution-light' : 'text-destructive-light'
}

export type SortKey =
    | 'apy'
    | 'commission'
    | 'growth30d'
    | 'growth7d'
    | 'name'
    | 'power'
    | 'realized30d'
    | 'uptime'
export type SortDir = 'asc' | 'desc'

export type ValidatorRow =
    ValidatorsQuery['validatorsHomepage']['validators'][number] & {
        stakeDelta7d?: number
        stakeDelta30d?: number
        currentStake?: number
        /** Net APY after this validator's commission. Undefined when the stake endpoint is down. */
        netApyPct?: number
        /** netApyPct minus realized supply growth: the gain over holding UM. */
        realYieldPct?: number
        /**
         * Measured reward rate: growth of the delegation-token exchange rate over
         * the last 30d, annualized. Null when pindexer has no history for it.
         */
        realizedApyPct?: number | null
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
    if (!sort) {return validators}
    const sorted = [...validators]
    const mul = dir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
        switch (sort) {
            case 'name':
                return mul * (nonEmpty(a.name) ?? a.id).localeCompare(nonEmpty(b.name) ?? b.id)
            case 'power':
                return (
                    mul *
                    ((a.currentStake ?? a.votingPower) -
                        (b.currentStake ?? b.votingPower))
                )
            case 'uptime':
                return mul * ((a.uptime ?? 0) - (b.uptime ?? 0))
            case 'commission':
                return mul * (a.commission - b.commission)
            case 'apy':
                // Validators outside the active set mint nothing, so they have
                // no yield: sort them last among the paying ones.
                return mul * ((a.netApyPct ?? -1) - (b.netApyPct ?? -1))
            case 'realized30d':
                return mul * ((a.realizedApyPct ?? -1) - (b.realizedApyPct ?? -1))
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
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="apy"
                        >
                            Est. APY (net)
                        </SortableHeader>
                    </TableCell>
                    <TableCell header>
                        <SortableHeader
                            currentSort={sort}
                            direction={sortDir}
                            sortKey="realized30d"
                        >
                            Realized 30d
                        </SortableHeader>
                    </TableCell>
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
                                    alt={nonEmpty(validator.name) ?? validator.id}
                                    fallback={placeholderAvatarImage}
                                    src={validatorImages[validator.id]}
                                    fallbackLetter
                                />
                                <Link href={`/explore/validators/${encodeURIComponent(validator.id)}`}>
                                    {nonEmpty(validator.name) ??
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
                                                validator.currentStake ??
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
                                                    validator.currentStake ??
                                                        validator.votingPower
                                                )}{' '}
                                                UM
                                            </span>
                                        </span>
                                        <span className="ml-7 text-xs text-text-secondary">
                                            {validator.votingPowerActivePercentage.toFixed(
                                                2
                                            )}
                                            %
                                        </span>
                                        {validator.currentStake !== undefined &&
                                            Math.abs(
                                                validator.currentStake -
                                                    validator.votingPower
                                            ) /
                                                Math.max(
                                                    validator.votingPower,
                                                    1
                                                ) >
                                                0.01 && (
                                                <span className="ml-7 text-[10px] text-text-secondary">
                                                    consensus:{' '}
                                                    {formatNumber(
                                                        validator.votingPower
                                                    )}{' '}
                                                    UM
                                                </span>
                                            )}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="h-15">
                                {typeof validator.uptime === 'number' ? (
                                    <span
                                        className={classNames(
                                            uptimeTone(validator.uptime)
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
                            <TableCell className="h-15">
                                {typeof validator.netApyPct === 'number' ? (
                                    <span className="inline-flex flex-col gap-1">
                                        <span className="font-mono">
                                            {validator.netApyPct.toFixed(2)}%
                                        </span>
                                        {typeof validator.realYieldPct ===
                                            'number' && (
                                            <span
                                                className={classNames(
                                                    'text-xs',
                                                    toneFor(
                                                        validator.realYieldPct
                                                    )
                                                )}
                                            >
                                                {validator.realYieldPct >= 0
                                                    ? '+'
                                                    : ''}
                                                {validator.realYieldPct.toFixed(
                                                    2
                                                )}
                                                % vs holding
                                            </span>
                                        )}
                                    </span>
                                ) : (
                                    <span className="text-text-secondary">
                                        —
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="h-15">
                                {typeof validator.realizedApyPct === 'number' ? (
                                    <span
                                        className={classNames(
                                            'font-mono',
                                            validator.realizedApyPct > 0
                                                ? 'text-text-primary'
                                                : 'text-text-secondary'
                                        )}
                                    >
                                        {validator.realizedApyPct.toFixed(2)}%
                                    </span>
                                ) : (
                                    <span className="text-text-secondary">
                                        —
                                    </span>
                                )}
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
                            colSpan={showDeltaCol ? 9 : 8}
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

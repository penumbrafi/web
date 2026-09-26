'use client';

import cn from 'clsx';
import Link from 'next/link';
import orderBy from 'lodash/orderBy';
import { ChevronDown, ChevronUp, SquareArrowOutUpRight } from 'lucide-react';
import { ReactNode, memo, useMemo, useRef, useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { Density } from '@penumbra-zone/ui/Density';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { TableCell } from '@penumbra-zone/ui/TableCell';
import { pnum } from '@penumbra-zone/types/pnum';
import { connectionStore } from '@/shared/model/connection';
import { useGetMetadata } from '@/shared/api/assets';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { useMarketPrice, usePortfolioMarketPrices } from '@/pages/trade/model/useMarketPrice';
import { usePathSymbols } from '@/pages/trade/model/use-path';
import { referenceMid, useUsdReferencePrices } from '@/shared/api/use-usd-reference-prices';
import { usePositions } from '../api/use-positions';
import { usePositionsStats } from '../api/use-positions-stats';
import { stateToString } from '../model/state-to-string';
import { getDisplayPositions } from '../model/get-display-positions';
import { DisplayPosition, ExecutedPosition } from '../model/types';
import { PositionsCurrentValue } from './positions-current-value';
import { Sensitive } from '@/shared/ui/sensitive';
import { PositionsFeesCell, PositionsAprCell, PositionsPnlCell } from './positions-stats-cells';
import { NotConnectedNotice } from './not-connected-notice';
import { ErrorNotice } from './error-notice';
import { NoPositions } from './no-positions';
import { HeaderActionButton } from './header-action-button';
import { ActionButton } from './action-button';
import { Dash } from './dash';
import { Pagination } from '@penumbra-zone/ui/Pagination';
import { PositionState_PositionStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { fullyWithdrawn } from '@/shared/utils/position';

export interface PositionsTableProps {
  base?: Metadata;
  quote?: Metadata;
  stateFilter?: PositionState_PositionStateEnum[];
  /**
   * Pair filter for screens that show every pair (/portfolio). Passing
   * `onPairKeyChange` renders a row of pair chips above the table; the
   * selection is owned by the caller so it survives tab switches. Omit on
   * /trade, where `base`/`quote` already scope the table to one pair.
   */
  pairKey?: string;
  onPairKeyChange?: (pairKey: string | undefined) => void;
}

/** Direction-free identity of a position's trading pair. */
const pairKeyOf = (position: DisplayPosition): string | undefined => {
  const pair = position.position.phi?.pair;
  const a = pair?.asset1?.inner;
  const b = pair?.asset2?.inner;
  if (!a || !b) {
    return undefined;
  }
  return `${bytesKey(a)}|${bytesKey(b)}`;
};

const bytesKey = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

interface PairOption {
  key: string;
  label: string;
  count: number;
}

const PairFilter = ({
  options,
  total,
  selected,
  onSelect,
}: {
  options: PairOption[];
  total: number;
  selected: string | undefined;
  onSelect: (pairKey: string | undefined) => void;
}) => {
  const chip = (key: string | undefined, label: string, count: number) => {
    const active = selected === key;
    return (
      <button
        key={key ?? 'all'}
        type='button'
        onClick={() => onSelect(key)}
        aria-pressed={active}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors',
          active
            ? 'border-primary-main bg-primary-main/15 text-text-primary'
            : 'border-other-tonal-stroke text-text-secondary hover:text-text-primary',
        )}
      >
        {label}
        <span className='tabular-nums opacity-60'>{count}</span>
      </button>
    );
  };
  return (
    <div className='mb-3 flex gap-2 overflow-x-auto pb-1'>
      {chip(undefined, 'All pairs', total)}
      {options.map(o => chip(o.key, o.label, o.count))}
    </div>
  );
};

// Module-scoped placeholder rows for the loading state. The shape only
// needs to satisfy the renderer's optional chains; previously we built
// this fresh every render even when isLoading was false. The five
// entries reference the same placeholder object, so a single allocation
// at module load is enough.
const LOADING_PLACEHOLDER = new Array(5).fill({
  position: {},
  orders: [
    {
      baseAsset: { asset: {} },
      quoteAsset: { asset: {} },
    },
  ],
}) as DisplayPosition[];

interface SortBy {
  key: string;
  direction: 'desc' | 'asc';
}

// Module-scoped + memo'd. Was previously defined inside PositionsTable
// via useCallback — but useCallback returns a new function whenever its
// deps change, and `sortBy` was in the deps, so every header click
// destroyed and remounted all six header DOM nodes. Hoisted out and
// receiving an `activeDirection` that's only set on the currently-
// sorted header (undefined for the others) lets memo skip every
// inactive header on each click — only the previously-active and the
// newly-active actually re-render.
const SortableTableHeader = memo(
  ({
    sortKey,
    activeDirection,
    onSelect,
    children,
  }: {
    sortKey: string;
    /** Direction when this is the active sort column, undefined otherwise. */
    activeDirection: 'asc' | 'desc' | undefined;
    onSelect: (next: SortBy) => void;
    children: ReactNode;
  }) => {
    const active = activeDirection !== undefined;
    const onClick = () => {
      onSelect({
        key: sortKey,
        direction: activeDirection === 'desc' ? 'asc' : 'desc',
      });
    };
    return (
      <TableCell heading>
        <button
          className={cn(
            'flex border-none bg-none',
            active ? 'text-text-primary' : 'text-text-secondary',
          )}
          onClick={onClick}
        >
          <Text tableHeadingSmall whitespace='nowrap'>
            {children}
          </Text>
          {activeDirection === 'asc' && <ChevronUp className='h-4 w-4' />}
          {activeDirection === 'desc' && <ChevronDown className='h-4 w-4' />}
        </button>
      </TableCell>
    );
  },
);

SortableTableHeader.displayName = 'SortableTableHeader';

const PAGE_SIZES = [25, 50, 100];

// What a row renders from; equal signatures mean the row can be reused.
const rowSignature = (row: DisplayPosition): string => {
  const r = row.position.reserves;
  const st = row.stats;
  return [
    row.state,
    r?.r1?.lo,
    r?.r1?.hi,
    r?.r2?.lo,
    r?.r2?.hi,
    row.marketPrice,
    st?.feesQuoteNumber,
    st?.aprPct?.toFixed(1),
    st?.pnlNumber,
    row.orders.map(o => o.direction).join('/'),
  ].join('|');
};

const PositionRow = memo(
  observer(
    ({
      position,
      isLoading,
      isLast,
    }: {
      position: DisplayPosition;
      isLoading: boolean;
      isLast: boolean;
    }) => (
      <>
        {position.orders.slice(0, position.isWithdrawn ? 1 : Infinity).map((order, orderIndex) => {
          const isLastCell =
            isLast || (position.orders.length > 1 && orderIndex === position.orders.length - 1);
          const variant = isLastCell ? 'lastCell' : 'cell';
          // Quote-per-order-base mid for this row (route mid on /trade,
          // this row's own pair book on /portfolio). Undefined when the
          // pair has no book — cells then render a Dash.
          const rowMarketPrice = position.marketPrice;

          return (
            <div key={orderIndex} className='col-span-11 grid grid-cols-subgrid [&>div]:h-10'>
              <TableCell loading={isLoading} variant={variant}>
                {position.isOpened ? (
                  <Text
                    as='div'
                    detail
                    color={order.direction === 'Buy' ? 'success.light' : 'destructive.light'}
                  >
                    {order.direction}
                  </Text>
                ) : (
                  <Text as='div' detail color='neutral.light'>
                    {stateToString(position.state)}
                  </Text>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {position.isWithdrawn ? (
                  <Dash />
                ) : (
                  <Sensitive>
                    <ValueViewComponent
                      priority='tertiary'
                      trailingZeros={false}
                      valueView={
                        position.isClosed && orderIndex === 1 ? order.basePrice : order.amount
                      }
                    />
                  </Sensitive>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {position.isClosed || position.isWithdrawn ? (
                  <Dash />
                ) : (
                  <Tooltip
                    message={
                      <>
                        <Text as='div' detail color='text.primary'>
                          Base price: {pnum(order.basePrice).toFormattedString()}
                        </Text>
                        <Text as='div' detail color='text.primary'>
                          Fee:{' '}
                          {pnum(order.basePrice)
                            .toBigNumber()
                            .minus(pnum(order.effectivePrice).toBigNumber())
                            .toString()}{' '}
                          ({position.fee})
                        </Text>
                        <Text as='div' detail color='text.primary'>
                          Effective price: {pnum(order.effectivePrice).toFormattedString()}
                        </Text>
                      </>
                    }
                  >
                    <div className='flex flex-col items-start'>
                      <ValueViewComponent
                        priority='tertiary'
                        valueView={order.effectivePrice}
                        trailingZeros={false}
                      />
                      {/* Distance from mid — surfaces which rungs are
                                at-the-money vs. deep in the book at a glance.
                                Penumbra positions are limit-like, so 'far
                                from mid' just means dormant, not broken — the
                                colour is informational, not alarming. */}
                      {position.isOpened &&
                        rowMarketPrice != null &&
                        rowMarketPrice > 0 &&
                        (() => {
                          const eff = pnum(order.effectivePrice).toNumber();
                          if (!Number.isFinite(eff) || eff <= 0) {
                            return null;
                          }
                          const deltaPct = ((eff - rowMarketPrice) / rowMarketPrice) * 100;
                          const abs = Math.abs(deltaPct);
                          const sign = deltaPct > 0 ? '+' : '';
                          // Past 2x a percentage stops reading
                          // ("+37719.94%"); a multiple doesn't.
                          const label =
                            deltaPct >= 100
                              ? `${(eff / rowMarketPrice).toFixed(1)}× mid`
                              : `${sign}${deltaPct.toFixed(2)}% from mid`;
                          let tone = 'text-neutral-light';
                          if (abs < 1) {
                            tone = 'text-success-light';
                          } else if (abs < 5) {
                            tone = 'text-text-secondary';
                          }
                          return (
                            <span
                              className={cn('text-[10px] tabular-nums', tone)}
                              style={{ lineHeight: 1 }}
                            >
                              {label}
                            </span>
                          );
                        })()}
                    </div>
                  </Tooltip>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {position.isClosed || position.isWithdrawn ? <Dash /> : position.fee}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {position.isClosed || position.isWithdrawn ? (
                  <Dash />
                ) : (
                  <ValueViewComponent
                    priority='tertiary'
                    valueView={order.basePrice}
                    trailingZeros={false}
                  />
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {fullyWithdrawn(position.position) ? (
                  <Dash />
                ) : (
                  <Sensitive>
                    <PositionsCurrentValue order={order} marketPrice={rowMarketPrice} />
                  </Sensitive>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {fullyWithdrawn(position.position) ? (
                  <Dash />
                ) : (
                  <Sensitive>
                    <PositionsFeesCell stats={position.stats} />
                  </Sensitive>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {fullyWithdrawn(position.position) ? (
                  <Dash />
                ) : (
                  <PositionsAprCell stats={position.stats} />
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                {fullyWithdrawn(position.position) ? (
                  <Dash />
                ) : (
                  <Sensitive>
                    <PositionsPnlCell stats={position.stats} />
                  </Sensitive>
                )}
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                <div className='flex max-w-[104px]'>
                  <Text as='div' detailTechnical color='text.primary' truncate>
                    {position.idString}
                  </Text>
                  <Link href={`/explore/lp/${position.idString}`}>
                    <SquareArrowOutUpRight className='h-4 w-4 text-text-secondary' />
                  </Link>
                </div>
              </TableCell>

              <TableCell loading={isLoading} variant={variant}>
                <ActionButton id={position.id} position={position.position} />
              </TableCell>
            </div>
          );
        })}
      </>
    ),
  ),
);
PositionRow.displayName = 'PositionRow';

export const PositionsTable = observer((props: PositionsTableProps) => {
  const { base, quote, stateFilter, pairKey, onPairKeyChange } = props;
  const { connected, subaccount } = connectionStore;
  const getMetadata = useGetMetadata();
  // Mid for the pair the table is scoped to. On /trade the route supplies a
  // pair and this value covers every row unchanged; on a screen with no
  // route pair (e.g. /portfolio) it is undefined and we resolve each row's
  // own pair book below.
  const { baseSymbol: routeBaseSymbol, quoteSymbol: routeQuoteSymbol } = usePathSymbols();
  const isRoutePair = Boolean(routeBaseSymbol) && Boolean(routeQuoteSymbol);
  const { marketPrice: routeBookMarketPrice } = useMarketPrice();

  const { data, isLoading, error } = usePositions(subaccount, stateFilter);

  // Wallet's owned position id list, deduped, used to fetch fees/APR/PNL
  // stats from pindexer in one round trip rather than per row.
  // Keyed on the id list itself, not the Map: each block hands back a new
  // Map with the same ids, and that must not refetch the stats.
  const idsSignature = data ? [...data.keys()].join(',') : '';
  const positionIds = useMemo(() => (idsSignature ? idsSignature.split(',') : []), [idsSignature]);
  const { data: statsResponse } = usePositionsStats(positionIds);
  const statsById = useMemo(() => {
    if (!statsResponse) {
      return undefined;
    }
    const map = new Map<string, (typeof statsResponse)['items'][number]>();
    for (const item of statsResponse.items) {
      map.set(bech32mPositionId(item.positionId), item);
    }
    return map;
  }, [statsResponse]);

  // Distinct canonical (asset1, asset2) pairs of the rows on screen, so each
  // row's Fees/APR/PNL/Current Value can be valued at its own pair's mid.
  // Skipped on /trade, where the single route mid already wins.
  const marketPairs = useMemo(() => {
    if (isRoutePair) {
      return [];
    }
    const seen = new Map<string, { base: string; quote: string }>();
    for (const position of data?.values() ?? []) {
      const { phi } = position as ExecutedPosition;
      const base = getMetadata(phi.pair.asset1)?.symbol;
      const quote = getMetadata(phi.pair.asset2)?.symbol;
      if (base && quote) {
        seen.set(`${base}|${quote}`, { base, quote });
      }
    }
    return [...seen.values()];
  }, [data, getMetadata, isRoutePair]);
  const bookMidByPair = usePortfolioMarketPrices(marketPairs);

  // Fair price from USD reference intel wins over the book mid wherever both
  // sides have it. Penumbra's books are thin and wide (UM/USDC.inj runs a
  // ~50% spread), so their midpoint put at-the-money rungs tens of percent
  // "from mid" and skewed the fee/PNL valuation that shares it.
  const referenceSymbols = useMemo(() => {
    if (isRoutePair) {
      return [routeBaseSymbol, routeQuoteSymbol].filter((s): s is string => Boolean(s));
    }
    return marketPairs.flatMap(({ base, quote }) => [base, quote]);
  }, [isRoutePair, routeBaseSymbol, routeQuoteSymbol, marketPairs]);
  const usdReference = useUsdReferencePrices(referenceSymbols);

  const routeMarketPrice =
    referenceMid(usdReference, routeBaseSymbol, routeQuoteSymbol) ?? routeBookMarketPrice;
  const pairMarketPrice = useMemo(() => {
    if (isRoutePair) {
      return undefined;
    }
    const merged = new Map(bookMidByPair);
    for (const { base, quote } of marketPairs) {
      const mid = referenceMid(usdReference, base, quote);
      if (mid !== undefined) {
        merged.set(`${base}|${quote}`, mid);
      }
    }
    return merged;
  }, [isRoutePair, bookMidByPair, marketPairs, usdReference]);

  // getDisplayPositions walks every fetched page and resolves metadata per
  // asset on each entry — non-trivial on a wallet with many LP positions.
  // Memoize so it only re-runs when the underlying inputs actually change.
  // useGetMetadata's return is now useCallback-stable so this dep is honest.
  // Rows whose content did not change keep their previous object, so the
  // memoized PositionRow skips them. Every block returns fresh Position
  // protos, which used to rebuild and re-render every row on every block.
  const stableRows = useRef(new Map<string, { sig: string; row: DisplayPosition }>());
  const displayPositions = useMemo(() => {
    const fresh = getDisplayPositions({
      positions: data,
      asset1Filter: base,
      asset2Filter: quote,
      getMetadata,
      statsById,
      marketPrice: routeMarketPrice,
      marketPriceByPair: pairMarketPrice,
    });
    const next = new Map<string, { sig: string; row: DisplayPosition }>();
    const rows = fresh.map(row => {
      const sig = rowSignature(row);
      const prev = stableRows.current.get(row.idString);
      const kept = prev?.sig === sig ? prev.row : row;
      next.set(row.idString, { sig, row: kept });
      return kept;
    });
    stableRows.current = next;
    return rows;
  }, [data, base, quote, getMetadata, statsById, routeMarketPrice, pairMarketPrice]);

  // Pages over the full list. Infinite scroll left a wallet with hundreds of
  // positions scrolling past everything to reach the one it wanted.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0] ?? 25);

  const [sortBy, setSortBy] = useState<SortBy>({
    key: 'effectivePrice',
    direction: 'desc',
  });

  // Pairs present in this tab, busiest first, labelled the way the rows
  // orient them (order base / quote).
  const pairOptions = useMemo<PairOption[]>(() => {
    if (!onPairKeyChange) {
      return [];
    }
    const byKey = new Map<string, PairOption>();
    for (const position of displayPositions) {
      const key = pairKeyOf(position);
      if (!key) {
        continue;
      }
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const order = position.orders[0];
      const baseSymbol = order?.baseAsset.asset.symbol ?? '?';
      const quoteSymbol = order?.quoteAsset.asset.symbol ?? '?';
      byKey.set(key, { key, label: `${baseSymbol}/${quoteSymbol}`, count: 1 });
    }
    return orderBy([...byKey.values()], ['count', 'label'], ['desc', 'asc']);
  }, [displayPositions, onPairKeyChange]);

  // A pair picked on another tab may have no rows here: show everything
  // rather than an empty table the user has to figure out.
  const activePairKey = pairKey && pairOptions.some(o => o.key === pairKey) ? pairKey : undefined;

  const sortedPositions = useMemo<DisplayPosition[]>(() => {
    const rows = activePairKey
      ? displayPositions.filter(p => pairKeyOf(p) === activePairKey)
      : displayPositions;
    return orderBy([...rows], `sortValues.${sortBy.key}`, sortBy.direction);
  }, [displayPositions, activePairKey, sortBy]);

  if (!connected) {
    return <NotConnectedNotice />;
  }

  if (error) {
    return <ErrorNotice />;
  }

  // A different pair filter or sort is a different list: start at its top.
  useEffect(() => setPage(1), [activePairKey, sortBy]);

  // A page past the end (after closing positions, or a narrower pair filter)
  // falls back to the last page instead of an empty table.
  const pageCount = Math.max(1, Math.ceil(sortedPositions.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const shownPositions = sortedPositions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  if (!isLoading && !sortedPositions.length) {
    return <NoPositions />;
  }

  return (
    <div
      className='grid grid-cols-[80px_1fr_1fr_80px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] overflow-x-auto overflow-y-auto'
      style={{ overflowAnchor: 'none' }}
    >
      {onPairKeyChange && pairOptions.length > 1 && (
        <div className='col-span-11'>
          <PairFilter
            options={pairOptions}
            total={displayPositions.length}
            selected={activePairKey}
            onSelect={onPairKeyChange}
          />
        </div>
      )}
      <Density slim>
        <div className='col-span-11 grid grid-cols-subgrid'>
          <SortableTableHeader
            sortKey='type'
            activeDirection={sortBy.key === 'type' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Type
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='tradeAmount'
            activeDirection={sortBy.key === 'tradeAmount' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Trade Amount
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='effectivePrice'
            activeDirection={sortBy.key === 'effectivePrice' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Effective Price
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='feeTier'
            activeDirection={sortBy.key === 'feeTier' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Fee Tier
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='basePrice'
            activeDirection={sortBy.key === 'basePrice' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Base Price
          </SortableTableHeader>
          <TableCell heading>Current Value</TableCell>
          <SortableTableHeader
            sortKey='feesQuote'
            activeDirection={sortBy.key === 'feesQuote' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Fees Earned
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='aprPct'
            activeDirection={sortBy.key === 'aprPct' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            APR
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='pnlVsHodl'
            activeDirection={sortBy.key === 'pnlVsHodl' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            vs HODL
          </SortableTableHeader>
          <SortableTableHeader
            sortKey='positionId'
            activeDirection={sortBy.key === 'positionId' ? sortBy.direction : undefined}
            onSelect={setSortBy}
          >
            Position ID
          </SortableTableHeader>
          <TableCell heading>
            <HeaderActionButton displayPositions={sortedPositions} />
          </TableCell>
        </div>

        {isLoading
          ? LOADING_PLACEHOLDER.map((position, index) => (
              <PositionRow key={index} position={position} isLoading isLast={false} />
            ))
          : shownPositions.map((position, index) => (
              <PositionRow
                key={position.idString}
                position={position}
                isLoading={false}
                isLast={index === shownPositions.length - 1}
              />
            ))}
      </Density>

      {sortedPositions.length > (PAGE_SIZES[0] ?? 25) && (
        <div className='col-span-11 pt-2'>
          <Pagination
            value={currentPage}
            onChange={setPage}
            limit={pageSize}
            limitOptions={PAGE_SIZES}
            onLimitChange={size => {
              setPageSize(size);
              setPage(1);
            }}
            totalItems={sortedPositions.length}
            visibleItems={shownPositions.length}
          />
        </div>
      )}
    </div>
  );
});

import { ReactNode, useEffect, useState } from 'react';
import cn from 'clsx';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Text } from '@penumbra-zone/ui/Text';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { Skeleton } from '@/shared/ui/skeleton';
import { useSummary } from '../api/use-summary';
import { useMarketPrice } from '../model/useMarketPrice';
import { TICK_ARROW, TICK_TEXT_COLOR, useTickDirection } from '../model/use-tick-direction';
import { DurationWindow, isDurationWindow } from '@/shared/utils/duration';
import { tradeFormStore } from './order-form/store/OrderFormStore';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { round } from '@penumbra-zone/types/round';
import { Density } from '@penumbra-zone/ui/Density';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { useGetMetadata } from '@/shared/api/assets';
import { convertPriceToDisplay } from '@/shared/math/price';
import { toValueView } from '@/shared/utils/value-view';

const SummaryCard = ({
  title,
  loading,
  children,
}: {
  title: string;
  loading?: boolean;
  children: ReactNode;
}) => {
  const [parent] = useAutoAnimate();

  return (
    <div ref={parent} className='flex flex-col gap-[2px]'>
      {loading ? (
        <>
          <div className='h-4 w-10'>
            <Skeleton />
          </div>
          <div className='h-4 w-18'>
            <Skeleton />
          </div>
        </>
      ) : (
        <>
          <Text detail color='text.secondary' whitespace='nowrap'>
            {title}
          </Text>
          {children}
        </>
      )}
    </div>
  );
};

// Subset of DurationWindow exposed to traders here — finer increments
// (1m, 15m) are noise for header summary, 1mo is the longest reliably-
// served window. Keeps the toggle row tight.
const SUMMARY_WINDOWS: { value: DurationWindow; label: string; cardLabel: string }[] = [
  { value: '1h', label: '1H', cardLabel: '1h' },
  { value: '4h', label: '4H', cardLabel: '4h' },
  { value: '1d', label: '24H', cardLabel: '24h' },
  { value: '1w', label: '7D', cardLabel: '7d' },
  { value: '1mo', label: '30D', cardLabel: '30d' },
];

const SUMMARY_WINDOW_KEY = 'veil_summary_window';

const readStoredWindow = (): DurationWindow => {
  if (typeof window === 'undefined') {return '1d';}
  const raw = window.localStorage.getItem(SUMMARY_WINDOW_KEY);
  return raw && isDurationWindow(raw) && SUMMARY_WINDOWS.some(w => w.value === raw) ? raw : '1d';
};

export const Summary = () => {
  // Default '1d' on SSR / first paint to keep hydration stable, then
  // hydrate from localStorage in an effect (same pattern as chart
  // timeframe + chart prefs + which-form). Persists across reloads so
  // a trader who lives on the 1H window doesn't have to re-pick.
  const [window, setWindow] = useState<DurationWindow>('1d');
  useEffect(() => {
    setWindow(readStoredWindow());
  }, []);
  const setAndPersistWindow = (next: DurationWindow) => {
    setWindow(next);
    try {
      globalThis.localStorage.setItem(SUMMARY_WINDOW_KEY, next);
    } catch {
      // ignore storage errors
    }
  };
  const cardLabel = SUMMARY_WINDOWS.find(w => w.value === window)?.cardLabel ?? '24h';

  const { data, isPending: isLoading, error } = useSummary(window);
  const getMetadata = useGetMetadata();
  const { marketPrice, bestBid, bestAsk, spreadPercentage } = useMarketPrice();
  const midDirection = useTickDirection(marketPrice);

  if (error) {
    return (
      <SummaryCard title=''>
        <BlockchainError />
      </SummaryCard>
    );
  }

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-text-primary'>
      {/* Window selector for the 24h / 7d / 30d aggregate cards. Mid and
          Last price are unaffected by this — they're per-tick, not
          windowed. Persisted to localStorage so traders who live on a
          shorter scope (scalpers on 1H) don't re-pick every load. */}
      <div className='flex items-center gap-1'>
        {SUMMARY_WINDOWS.map(w => (
          <button
            key={w.value}
            type='button'
            onClick={() => setAndPersistWindow(w.value)}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-xs tabular-nums transition-colors',
              w.value === window
                ? 'border-primary-main bg-other-tonal-fill5 text-text-primary'
                : 'border-other-tonal-stroke text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>
      {/* Live midprice off the on-chain liquidity-position route book —
          what the DEX would actually clear a marginal swap at right now,
          regardless of when the last trade landed. Distinct from 'Last
          price' which can be hours stale on quiet pairs. */}
      <SummaryCard title='Mid price' loading={isLoading && marketPrice == null}>
        <Tooltip message='Average of the best bid and best ask on the on-chain route book — the price the DEX would clear a marginal swap at right now. The smaller number is the spread between bid and ask, in basis points of mid — a wider spread means more cost to cross.'>
          <div className='flex items-center gap-1'>
            <Text
              detail
              color={TICK_TEXT_COLOR[midDirection]}
            >
              {TICK_ARROW[midDirection]}
              {marketPrice != null ? round({ value: marketPrice, decimals: 6 }) : '-'}
            </Text>
            {/* Spread as % of mid — book tightness at a glance. Same
                number the route-book SpreadRow shows; surface it on the
                Mid card too so a trader can vet a pair from the header
                alone without scanning to the order book. */}
            {spreadPercentage != null && Number.isFinite(spreadPercentage) && (
              <Text detail color='text.secondary'>
                · {spreadPercentage.toFixed(2)}%
              </Text>
            )}
          </div>
        </Tooltip>
      </SummaryCard>
      {/* Best bid + best ask side-by-side. Mid is the average of these
          two; surfacing them explicitly tells the trader the actual prices
          they could trade at right now (versus the synthetic mid). Each
          number is clickable: bid → set up a sell limit at that price,
          ask → buy limit at that price. Same gesture as clicking a row
          in the route-book table. */}
      <SummaryCard title='Bid / Ask' loading={isLoading && bestBid == null}>
        {bestBid != null && bestAsk != null ? (
          // No <Tooltip> wrapper here — it would render as a button and
          // the inner clickable bid/ask spans are also buttons, which
          // throws 'button cannot contain a nested button' in React.
          // The per-button title attrs explain the click action.
          <div
            className='flex items-center gap-1 font-mono text-xs tabular-nums'
            title='Highest active buy (bid) and lowest active sell (ask) on the on-chain route book. Click bid → sell limit at that price; click ask → buy limit.'
          >
            <button
              type='button'
              onClick={() => {
                tradeFormStore.setWhichForm('Limit');
                tradeFormStore.limitForm.setDirection('sell');
                tradeFormStore.limitForm.setPriceInput(
                  round({ value: bestBid, decimals: 6 }),
                );
              }}
              title='Click to set a sell limit at the bid'
              className='cursor-pointer hover:underline'
            >
              <Text detail color='success.light'>
                {round({ value: bestBid, decimals: 6 })}
              </Text>
            </button>
            <Text detail color='text.secondary'>
              /
            </Text>
            <button
              type='button'
              onClick={() => {
                tradeFormStore.setWhichForm('Limit');
                tradeFormStore.limitForm.setDirection('buy');
                tradeFormStore.limitForm.setPriceInput(
                  round({ value: bestAsk, decimals: 6 }),
                );
              }}
              title='Click to set a buy limit at the ask'
              className='cursor-pointer hover:underline'
            >
              <Text detail color='destructive.light'>
                {round({ value: bestAsk, decimals: 6 })}
              </Text>
            </button>
          </div>
        ) : (
          <Text detail color='text.primary'>
            -
          </Text>
        )}
      </SummaryCard>
      <SummaryCard title='Last price' loading={isLoading}>
        <Tooltip message='Most recent fill on this pair. Lags the mid price on quiet pairs.'>
          <Text detail color='text.primary'>
            {data?.price ? round({ value: data.price, decimals: 6 }) : '-'}
          </Text>
        </Tooltip>
      </SummaryCard>
      <SummaryCard title={`${cardLabel} Change`} loading={isLoading}>
        {data && (
          <div className={cn('flex items-center gap-1', getColor(data.priceDelta, false))}>
            <Text detail>{round({ value: data.priceDelta, decimals: 6 })}</Text>
            <span
              className={cn(
                'flex h-4 rounded-full px-1 text-success-dark',
                getColor(data.priceChangePercent, true),
              )}
            >
              <Text detail>
                {getTextSign(data.priceChangePercent)}
                {data.priceChangePercent.toFixed(2)}%
              </Text>
            </span>
          </div>
        )}
      </SummaryCard>
      <SummaryCard title={`${cardLabel} High`} loading={isLoading}>
        <Text detail color='text.primary'>
          {data
            ? round({ value: convertPriceToDisplay(data.high, data.start, data.end), decimals: 6 })
            : '-'}
        </Text>
      </SummaryCard>
      <SummaryCard title={`${cardLabel} Low`} loading={isLoading}>
        <Text detail color='text.primary'>
          {data
            ? round({ value: convertPriceToDisplay(data.low, data.start, data.end), decimals: 6 })
            : '-'}
        </Text>
      </SummaryCard>
      <SummaryCard title={`${cardLabel} Volume`} loading={isLoading}>
        {data ? (
          <Density compact>
            <ValueViewComponent
              valueView={toValueView({ value: data.volume, getMetadata })}
              context='table'
              abbreviate
            />
          </Density>
        ) : (
          <Text detail color='text.primary'>
            -
          </Text>
        )}
      </SummaryCard>
      {/* Total route-book liquidity in display denom — already computed
          server-side (SUM(liquidity × price) over the pair) but wasn't
          surfaced before. Reads as 'depth available right now', a
          first-pass pair-vetting signal a trader scans before sizing. */}
      <SummaryCard title='Liquidity' loading={isLoading}>
        {data ? (
          <Tooltip message='Total depth of the route book on this pair, valued in the indexing denom. A higher number means a market order can absorb more size before crossing through the book.'>
            <Density compact>
              <ValueViewComponent
                valueView={toValueView({ value: data.liquidity, getMetadata })}
                context='table'
                abbreviate
              />
            </Density>
          </Tooltip>
        ) : (
          <Text detail color='text.primary'>
            -
          </Text>
        )}
      </SummaryCard>
    </div>
  );
};

const getTextSign = (x: number) => {
  if (x > 0.0) {
    return '+';
  }
  if (x < 0.0) {
    return '-';
  }
  return '';
};

const getColor = (x: number, isBg = false): string => {
  if (x > 0.0) {
    return isBg ? 'bg-success-light' : 'text-success-light';
  }
  if (x < 0.0) {
    return isBg ? 'bg-destructive-light' : 'text-destructive-light';
  }
  return isBg ? 'bg-neutral-light' : 'text-neutral-light';
};

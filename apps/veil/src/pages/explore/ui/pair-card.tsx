import { ReactNode, memo } from 'react';
import { Star, CandlestickChart } from 'lucide-react';
import cn from 'clsx';
import Link from 'next/link';
import { shortify } from '@penumbra-zone/types/shortify';
import { getFormattedAmtFromValueView } from '@penumbra-zone/types/value-view';
import { round } from '@penumbra-zone/types/round';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { Density } from '@penumbra-zone/ui/Density';
import { AssetIcon } from '@penumbra-zone/ui/AssetIcon';
import ChevronDown from './chevron-down.svg';
import { PreviewChart } from './preview-chart';
import { SummaryWithPrices } from '@/shared/api/server/summary';
import { useGetMetadata } from '@/shared/api/assets';
import { toValueView } from '@/shared/utils/value-view';
import { convertPriceToDisplay } from '@/shared/math/price';
import { getTradePairPath } from '@/shared/const/pages';
import {
  isPairHealthy,
  BRIDGE_PAUSED_LABEL,
  BRIDGE_PAUSED_TOOLTIP,
} from '@/shared/config/featured-pairs';

const getTextSign = (change: number): ReactNode => {
  if (change > 0) {
    return <ChevronDown className='inline-block size-3 rotate-180' />;
  }
  if (change < 0) {
    return <ChevronDown className='inline-block size-3' />;
  }
  return null;
};

const getColor = (change: number): string => {
  if (change > 0) {
    return 'text-success-light';
  }
  if (change < 0) {
    return 'text-destructive-light';
  }
  return 'text-neutral-light';
};

export interface PairCardProps {
  summary: SummaryWithPrices;
}

// Wrapped in memo so a parent re-render (e.g. typing into the explore-page
// filter) only re-renders cards whose summary actually changed.
// SummaryWithPrices objects are structurally-shared by React Query so
// identity equality is the right comparison here.
export const PairCard = memo(({ summary }: PairCardProps) => {
  // Time window pinned to the summary's own recent-prices boundaries.
  // Reading `new Date()` in the render body diverges between server-render
  // and client-hydration (React #418/#425), which the preview-chart's SVG
  // polyline coordinates then bake into hydration-mismatched markup. The
  // recentPrices array is a server-computed 24-interval series, so its
  // first and last timestamps ARE the window we want to draw.
  const firstPrice = summary.recentPrices[0];
  const lastPrice = summary.recentPrices[summary.recentPrices.length - 1];
  // Fallback for the empty-series edge case; both sides see the same 0
  // epoch so it still hydrates deterministically.
  const from = firstPrice ? firstPrice[0] : new Date(0);
  const to = lastPrice ? lastPrice[0] : new Date(0);

  const getMetadata = useGetMetadata();
  const startMetadata = getMetadata(summary.start);
  if (!startMetadata) {
    throw new Error(`unknown asset: ${summary.start.toJsonString()}`);
  }
  const endMetadata = getMetadata(summary.end);
  if (!endMetadata) {
    throw new Error(`unknown asset: ${summary.end.toJsonString()}`);
  }
  const liquidityMetadata = getMetadata(summary.liquidity.assetId);
  const volumeMetadata = getMetadata(summary.volume.assetId);

  const paused = !isPairHealthy(startMetadata.symbol, endMetadata.symbol);

  return (
    <Link
      href={getTradePairPath(startMetadata.symbol, endMetadata.symbol)}
      className={cn(
        'col-span-6 grid cursor-pointer grid-cols-subgrid rounded-sm p-3 transition-colors hover:bg-action-hover-overlay',
        paused && 'opacity-45 hover:opacity-70',
      )}
    >
      <div className='relative flex h-10 items-center gap-2 text-text-primary'>
        <Density compact>
          <Button icon={Star} iconOnly>
            Favorite
          </Button>
        </Density>

        <div className='z-10'>
          <AssetIcon metadata={startMetadata} size='lg' />
        </div>
        <div className='-ml-4'>
          <AssetIcon metadata={endMetadata} size='lg' />
        </div>

        <Text body>
          {startMetadata.symbol}/{endMetadata.symbol}
        </Text>

        {paused && (
          <span
            title={BRIDGE_PAUSED_TOOLTIP}
            className='whitespace-nowrap rounded-xs bg-secondary-dark px-1.5 py-0.5 text-textXs text-text-secondary'
          >
            {BRIDGE_PAUSED_LABEL}
          </span>
        )}
      </div>

      <div className='flex h-10 flex-col items-end justify-center'>
        <Text color='text.primary'>
          {round({
            value: convertPriceToDisplay(summary.price, startMetadata, endMetadata),
            decimals: 6,
          })}
        </Text>
        <Text detail color='text.secondary'>
          {endMetadata.symbol}
        </Text>
      </div>

      <div className='flex h-10 flex-col items-end justify-center'>
        <Text color='text.primary'>
          {shortify(
            Number(
              getFormattedAmtFromValueView(toValueView({ value: summary.liquidity, getMetadata })),
            ),
          )}
        </Text>
        <Text detail color='text.secondary'>
          {liquidityMetadata?.symbol}
        </Text>
      </div>

      <div className='flex h-10 flex-col items-end justify-center'>
        <Text color='text.primary'>
          {shortify(
            Number(
              getFormattedAmtFromValueView(toValueView({ value: summary.volume, getMetadata })),
            ),
          )}
        </Text>
        <Text detail color='text.secondary'>
          {volumeMetadata?.symbol}
        </Text>
      </div>

      <div className='flex h-10 items-center justify-end gap-2'>
        <div className={cn('flex items-center', getColor(summary.priceChangePercent))}>
          {getTextSign(summary.priceChangePercent)}
          <Text>{summary.priceChangePercent.toFixed(2)}%</Text>
        </div>

        <PreviewChart
          sign={summary.priceChangePercent}
          values={summary.recentPrices.map(x => x[1])}
          dates={summary.recentPrices.map(x => x[0])}
          intervals={24}
          from={from}
          to={to}
        />
      </div>

      <div className='flex h-10 flex-col items-end justify-center'>
        <Density compact>
          <Button icon={CandlestickChart} iconOnly>
            Actions
          </Button>
        </Density>
      </div>
    </Link>
  );
});

PairCard.displayName = 'PairCard';

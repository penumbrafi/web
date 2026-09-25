import { memo } from 'react';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { Text } from '@penumbra-zone/ui/Text';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { PositionDerivedStats } from '../model/types';
import { Dash } from './dash';
import { MIN_AGE_DAYS_FOR_APR } from '../model/get-position-stats';

const formatPct = (n: number): string => {
  // Compact APR display — three figures of significance is enough; large
  // values get truncated to k% to keep the column narrow.
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return `${(n / 1000).toFixed(1)}k%`;
  }
  if (abs >= 100) {
    return `${n.toFixed(0)}%`;
  }
  return `${n.toFixed(2)}%`;
};

const Loading = () => (
  <div className='h-4 w-12'>
    <Skeleton />
  </div>
);

export const PositionsFeesCell = memo(({ stats }: { stats: PositionDerivedStats | undefined }) => {
  if (!stats) {
    return <Loading />;
  }
  if (stats.feesQuoteNumber === 0) {
    return <Dash />;
  }
  return <ValueViewComponent valueView={stats.feesQuote} priority='tertiary' />;
});
PositionsFeesCell.displayName = 'PositionsFeesCell';

export const PositionsAprCell = memo(({ stats }: { stats: PositionDerivedStats | undefined }) => {
  if (!stats) {
    return <Loading />;
  }
  if (stats.aprPct === undefined) {
    if (stats.feesQuoteNumber > 0 && stats.ageDays < MIN_AGE_DAYS_FOR_APR) {
      return (
        <Tooltip message={`APR shows once the position is ${MIN_AGE_DAYS_FOR_APR} days old`}>
          <Dash />
        </Tooltip>
      );
    }
    return <Dash />;
  }
  // Green is reserved for positive yield; tiny/zero APR stays neutral so
  // dormant positions don't visually claim wins they haven't earned.
  const color: 'success.light' | 'text.secondary' =
    stats.aprPct > 0 ? 'success.light' : 'text.secondary';
  return (
    <Text as='div' detail color={color}>
      {formatPct(stats.aprPct)}
    </Text>
  );
});
PositionsAprCell.displayName = 'PositionsAprCell';

export const PositionsPnlCell = memo(({ stats }: { stats: PositionDerivedStats | undefined }) => {
  if (!stats) {
    return <Loading />;
  }
  if (!stats.pnlValue) {
    return <Dash />;
  }
  // PNL vs HODL isolates fee earnings from price drift: a positive number
  // means the LP outperformed buying-and-holding the opening reserves at
  // current mid; a negative one means impermanent loss has eaten more than
  // fees collected.
  const positive = stats.pnlNumber >= 0;
  return (
    <Tooltip
      message={
        <Text as='div' detail color='text.primary'>
          P/L vs holding the opening reserves at current mid. Positive = the LP earned more in fees
          than impermanent loss; negative = price drift cost more than the fees you collected.
        </Text>
      }
    >
      <div className={positive ? 'text-success-light' : 'text-destructive-light'}>
        <ValueViewComponent valueView={stats.pnlValue} priority='tertiary' />
      </div>
    </Tooltip>
  );
});
PositionsPnlCell.displayName = 'PositionsPnlCell';

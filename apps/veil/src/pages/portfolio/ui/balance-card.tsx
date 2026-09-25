'use client';

import { useState } from 'react';
import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { ArrowDownToLine, ArrowUpFromLine, Info } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Density } from '@penumbra-zone/ui/Density';
import { Tabs } from '@penumbra-zone/ui/Tabs';
import { Text } from '@penumbra-zone/ui/Text';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { Skeleton } from '@/shared/ui/skeleton';
import { BalanceVisibilityToggle, Sensitive } from '@/shared/ui/sensitive';
import { HISTORY_RANGES, HistoryRange } from '@/shared/api/server/portfolio-history/types';
import { useBalanceHistory } from '../api/use-balance-history';
import { BalanceChart } from './balance-chart';

const RANGE_LABEL: Record<HistoryRange, string> = {
  '1d': '1D',
  '7d': '7D',
  '30d': '30D',
  max: 'Max',
};

const RANGE_OPTIONS = HISTORY_RANGES.map(value => ({ value, label: RANGE_LABEL[value] }));

const usd = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DepositWithdrawButtons = () => (
  <div className='flex gap-2'>
    <Link href='/portfolio/deposit'>
      <Button actionType='accent' priority='primary' density='compact' icon={ArrowDownToLine}>
        Deposit
      </Button>
    </Link>
    <Link href='/portfolio/withdraw'>
      <Button priority='secondary' density='compact' icon={ArrowUpFromLine}>
        Withdraw
      </Button>
    </Link>
  </div>
);

/**
 * Top of the portfolio: wallet value, its 24h change and its history.
 * Everything here is computed in the browser from the wallet's own notes.
 */
export const BalanceCard = observer(() => {
  const [range, setRange] = useState<HistoryRange>('7d');
  const { points, current, change24h, isLoading } = useBalanceHistory(range);

  let changeTone = 'text-text-secondary';
  if (change24h !== undefined && change24h > 0) {
    changeTone = 'text-success-light';
  } else if (change24h !== undefined && change24h < 0) {
    changeTone = 'text-destructive-light';
  }
  const before = current !== undefined && change24h !== undefined ? current - change24h : 0;
  const changePct = before > 0 && change24h !== undefined ? (change24h / before) * 100 : undefined;

  return (
    <div className='flex flex-col gap-4 rounded-lg bg-other-tonal-fill5 p-6 backdrop-blur-lg'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex flex-wrap gap-10'>
          <div className='flex flex-col gap-1'>
            <div className='flex items-center gap-1'>
              <Text small color='text.secondary'>
                Wallet balance
              </Text>
              <Tooltip message='Shielded balance of this account, valued at DEX prices. Liquidity positions and staked UM are not included.'>
                <Info className='h-3.5 w-3.5 text-neutral-light' />
              </Tooltip>
            </div>
            {current === undefined ? (
              <div className='h-8 w-40'>
                <Skeleton />
              </div>
            ) : (
              <Sensitive>
                <span className='font-mono text-3xl text-text-primary'>{usd(current)} USD</span>
              </Sensitive>
            )}
          </div>
          {change24h !== undefined && (
            <div className='flex flex-col gap-1'>
              <Text small color='text.secondary'>
                24h change
              </Text>
              <div className={`flex items-baseline gap-2 font-mono text-xl ${changeTone}`}>
                <Sensitive>
                  <span>
                    {change24h >= 0 ? '+' : '−'}
                    {usd(Math.abs(change24h))} USD
                  </span>
                </Sensitive>
                {changePct !== undefined && (
                  <span className='text-sm'>
                    {changePct >= 0 ? '+' : ''}
                    {changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <BalanceVisibilityToggle />
          <DepositWithdrawButtons />
        </div>
      </div>

      <div className='w-fit'>
        <Density compact>
          <Tabs
            value={range}
            actionType='accent'
            onChange={value => setRange(value as HistoryRange)}
            options={RANGE_OPTIONS}
          />
        </Density>
      </div>

      {isLoading && points.length === 0 ? (
        <div className='h-[240px] w-full'>
          <Skeleton />
        </div>
      ) : (
        <BalanceChart points={points} />
      )}
    </div>
  );
});

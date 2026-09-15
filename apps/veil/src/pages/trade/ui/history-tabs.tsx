'use client';

import { useCallback, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Tabs } from '@penumbra-zone/ui/Tabs';
import { Density } from '@penumbra-zone/ui/Density';
import { PositionsTable } from '@/entities/position';
import { usePathToMetadata } from '../model/use-path';
import { PositionState_PositionStateEnum as State } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { MyTrades } from './trades/my-trades';

enum PositionsTabsType {
  /** OPENED positions — actively quoting on-chain. */
  OPEN_POSITIONS = 'OPEN_POSITIONS',
  /** CLOSED positions — done quoting, reserves still locked. Bulk-withdraw target. */
  CLOSED_POSITIONS = 'CLOSED_POSITIONS',
  /** WITHDRAWN positions — terminal state, kept for record. */
  POSITION_HISTORY = 'POSITION_HISTORY',
  /** Swap fills the user actually executed (separate from LP positions). */
  TRADE_HISTORY = 'TRADE_HISTORY',
}

// Module-scoped — same reasoning as form-tabs: avoid re-allocating four
// option objects per render and the corresponding identity churn.
const HISTORY_TAB_OPTIONS = [
  { value: PositionsTabsType.OPEN_POSITIONS, label: 'Open positions' },
  { value: PositionsTabsType.CLOSED_POSITIONS, label: 'Closed' },
  { value: PositionsTabsType.POSITION_HISTORY, label: 'Position history' },
  { value: PositionsTabsType.TRADE_HISTORY, label: 'Trade history' },
];

// Same idiom — these single-element arrays never change between renders
// but were previously being allocated fresh on every parent re-render
// and handed to PositionsTable / usePositions / React Query as a prop
// + queryKey component. Hoist to module scope so the identity stays
// stable and downstream memoization actually works.
const FILTER_OPENED = [State.OPENED];
const FILTER_CLOSED = [State.CLOSED];
const FILTER_WITHDRAWN = [State.WITHDRAWN];

/**
 * Bottom panel tabs — split out from a single 'My Positions' view that
 * mixed open and closed by default and hid withdrawn behind a toggle.
 *
 *   - 'Open positions' shows what you have quoting right now.
 *   - 'Closed' shows what's been closed and is waiting on a withdraw to
 *     return reserves; PositionsTable's bulk-withdraw button picks these
 *     up automatically (tab is the right place to surface it).
 *   - 'Position history' is the terminal-state log of withdrawn positions.
 *   - 'Trade history' lists the user's swap fills (separate from LPs).
 *     Pending the dex-tx query — placeholder for now.
 */
export const HistoryTabs = () => {
  const [parent] = useAutoAnimate();
  const [tab, setTab] = useState<PositionsTabsType>(PositionsTabsType.OPEN_POSITIONS);
  const { baseAsset, quoteAsset } = usePathToMetadata();

  const onTabChange = useCallback((value: string) => setTab(value as PositionsTabsType), []);

  return (
    <div ref={parent} className='flex w-screen flex-col desktop:w-auto'>
      <div className='flex items-center justify-between gap-2 border-b border-b-other-solid-stroke px-4'>
        <Density compact>
          <Tabs
            value={tab}
            actionType='accent'
            onChange={onTabChange}
            options={HISTORY_TAB_OPTIONS}
          />
        </Density>
      </div>

      <div className='p-4'>
        {tab === PositionsTabsType.OPEN_POSITIONS && (
          <PositionsTable base={baseAsset} quote={quoteAsset} stateFilter={FILTER_OPENED} />
        )}
        {tab === PositionsTabsType.CLOSED_POSITIONS && (
          <PositionsTable base={baseAsset} quote={quoteAsset} stateFilter={FILTER_CLOSED} />
        )}
        {tab === PositionsTabsType.POSITION_HISTORY && (
          <PositionsTable base={baseAsset} quote={quoteAsset} stateFilter={FILTER_WITHDRAWN} />
        )}
        {tab === PositionsTabsType.TRADE_HISTORY && <MyTrades />}
      </div>
    </div>
  );
};

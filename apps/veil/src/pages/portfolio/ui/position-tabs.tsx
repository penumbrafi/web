import { useState } from 'react';
import { Tabs } from '@penumbra-zone/ui/Tabs';
import { Density } from '@penumbra-zone/ui/Density';
import { PortfolioTransactions } from './transactions';
import { PortfolioCard } from '@/pages/portfolio/ui/portfolio-card.tsx';
import { PositionsSummary } from './positions-summary';
import { PositionsTable } from '@/entities/position';
import { PositionState_PositionStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';

enum PortfolioTab {
  OpenPositions = 'Open Positions',
  ClosedPositions = 'Closed Positions',
  History = 'History',
}

export const PortfolioPositionTabs = () => {
  const [tab, setTab] = useState(PortfolioTab.OpenPositions);

  return (
    <PortfolioCard>
      <PositionsSummary />
      <div className='mb-4 w-full border-b border-b-other-tonal-stroke'>
        <Density compact>
          <Tabs
            value={tab}
            actionType='accent'
            onChange={value => setTab(value as PortfolioTab)}
            options={[
              { value: PortfolioTab.OpenPositions, label: PortfolioTab.OpenPositions },
              { value: PortfolioTab.ClosedPositions, label: PortfolioTab.ClosedPositions },
              { value: PortfolioTab.History, label: PortfolioTab.History },
            ]}
          />
        </Density>
      </div>

      {tab === PortfolioTab.OpenPositions && (
        <PositionsTable stateFilter={[PositionState_PositionStateEnum.OPENED]} />
      )}

      {tab === PortfolioTab.ClosedPositions && (
        // WITHDRAWN positions have zero reserves and are already claimed;
        // they belong on the History tab (they show up there as a
        // 'Withdraw' tx), not sitting forever in Closed. Keeping only
        // CLOSED here lets the tab track what the user still needs to
        // withdraw.
        <PositionsTable stateFilter={[PositionState_PositionStateEnum.CLOSED]} />
      )}

      {tab === PortfolioTab.History && <PortfolioTransactions />}
    </PortfolioCard>
  );
};

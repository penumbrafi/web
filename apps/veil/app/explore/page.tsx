import { FC } from 'react';
import {
  ActiveProposalPanelContainer,
  BlockPanelContainer,
  BlockTableContainer,
  SearchContainer,
  TransactionPanelContainer,
  TransactionTableContainer,
} from '@/pages/inspect/explorer/containers';
import { Button, Container } from '@/pages/inspect/explorer/components';

// /explore home defaults to a static prerender, which means the SSR'd
// 'Latest blocks' / 'Latest transactions' lists were frozen at the build
// timestamp and stale-tabs would still show 3-hour-old rows even after
// the live WS subscription updated 'Current block'. ISR every 30s rebuilds
// the snapshot in the background so cold loads land on fresh rows.
export const dynamic = 'force-dynamic';

const InspectHomePage: FC = () => (
  <>
    <Container>
      <h1 className='mb-2 font-heading text-4xl font-medium'>Penumbra Chain Explorer</h1>
      <SearchContainer />
    </Container>
    <Container className='flex flex-col gap-4'>
      <div>
        <ActiveProposalPanelContainer />
        <div className='flex flex-col gap-4 md:flex-row'>
          <BlockPanelContainer className='flex-1' />
          <TransactionPanelContainer className='flex-1' />
        </div>
      </div>
      <div className='flex flex-col gap-4 lg:flex-row'>
        <BlockTableContainer
          className='flex-1'
          header={
            <div className='flex items-center justify-between'>
              <h2 className='text-2xl font-medium'>Latest blocks</h2>
              <Button density='compact' href='/explore/blocks'>
                View all
              </Button>
            </div>
          }
          limit={{ length: 10 }}
          subscription
        />
        <TransactionTableContainer
          className='flex-1'
          header={
            <div className='flex items-center justify-between'>
              <h2 className='text-2xl font-medium'>Latest transactions</h2>
              <Button density='compact' href='/explore/txs'>
                View all
              </Button>
            </div>
          }
          limit={{ length: 10 }}
          blockHeight
          subscription
        />
      </div>
    </Container>
  </>
);

export default InspectHomePage;

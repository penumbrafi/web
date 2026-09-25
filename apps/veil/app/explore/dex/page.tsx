import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import {
  DexExecutionContainer,
  DexExecutionPanelContainer,
  DexMarketOverviewContainer,
  DexPositionPanelContainer,
  DexPositionTableContainer,
  DexPriceTableContainer,
  DexVolumeHistoryContainer,
} from '@/pages/inspect/explorer/containers';
import { LiquidityPositionStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types';
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ page?: string; range?: string }>;
}

const DEFAULT_RANGE_DAYS = 30;

const DexPage: FC<Props> = async props => {
  const searchParams = await props.searchParams;
  const page = searchParams.page ? Math.max(0, Number(searchParams.page) - 1) : 0;
  const rangeParam = searchParams.range ? Number(searchParams.range) : DEFAULT_RANGE_DAYS;
  const days = Number.isFinite(rangeParam) && rangeParam > 0 ? rangeParam : DEFAULT_RANGE_DAYS;

  const length = 20;
  const offset = page * length;

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>DEX</Breadcrumb>
      </Breadcrumbs>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <DexPositionPanelContainer />
        <DexExecutionPanelContainer />
      </div>

      <DexVolumeHistoryContainer days={days} />

      <DexMarketOverviewContainer />

      <div className='flex flex-col gap-4 lg:flex-row'>
        <DexExecutionContainer />
        <DexPriceTableContainer className='flex-1' />
      </div>

      <DexPositionTableContainer
        header={<h2 className='text-2xl font-medium'>Open positions</h2>}
        limit={{ length, offset }}
        pagination
        stateFilter={LiquidityPositionStateFilter.Open}
      />
    </Container>
  );
};

export default DexPage;

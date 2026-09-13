export const dynamic = 'force-dynamic';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { DexMarketOverviewContainer } from '@/pages/inspect/explorer/containers';

const DexPage: FC = () => {
  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>DEX</Breadcrumb>
      </Breadcrumbs>
      <DexMarketOverviewContainer />
    </Container>
  );
};

export default DexPage;

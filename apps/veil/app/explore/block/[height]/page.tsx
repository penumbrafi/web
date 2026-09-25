import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { BlockViewContainer } from '@/pages/inspect/explorer/containers';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ height: string }>;
}

const BlockViewPage: FC<Props> = async props => {
  const params = await props.params;
  const blockHeight = Number(params.height);

  if (Number.isNaN(blockHeight)) {
    notFound();
  }

  return (
    <Container narrow>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb href='/explore/blocks'>Blocks</Breadcrumb>
      </Breadcrumbs>
      <BlockViewContainer blockHeight={blockHeight} />
    </Container>
  );
};

export default BlockViewPage;

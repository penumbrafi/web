import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { BlockTableContainer } from '@/pages/inspect/explorer/containers';
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ page?: string }>;
}

const BlocksPage: FC<Props> = async props => {
  const searchParams = await props.searchParams;
  const page = searchParams.page ? Number(searchParams.page) - 1 : 0;

  if (Number.isNaN(page) || page < 0) {
    notFound();
  }

  const length = 20;
  const offset = page * length;

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>Blocks</Breadcrumb>
      </Breadcrumbs>
      <BlockTableContainer
        header={<h1 className='text-2xl font-medium'>Blocks</h1>}
        limit={{ length, offset }}
        pagination
        // Live-update only on page 1 (the head). Paginated pages would
        // get push events about heights that aren't on screen, which
        // would just churn state for no benefit.
        subscription={page === 0}
      />
    </Container>
  );
};

export default BlocksPage;

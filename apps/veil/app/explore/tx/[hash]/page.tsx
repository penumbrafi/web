import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { TransactionViewContainer } from '@/pages/inspect/explorer/containers';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ hash: string }>;
}

const TransactionViewPage: FC<Props> = async props => {
  const params = await props.params;

  if (!params.hash) {
    notFound();
  }

  return (
    <Container narrow>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb href='/explore/txs'>Transactions</Breadcrumb>
      </Breadcrumbs>
      {/* Has its own Decrypt toggle for the connected wallet's transactions. */}
      <TransactionViewContainer transactionHash={params.hash} />
    </Container>
  );
};

export default TransactionViewPage;

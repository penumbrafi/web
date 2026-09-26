import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { TransactionViewContainer } from '@/pages/inspect/explorer/containers';
import { PrivateTxView } from '@/widgets/private-tx-view';
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
      {/* Client-side: renders only for a transaction the connected wallet
          can decrypt; the public view below is unchanged. */}
      <PrivateTxView txHash={params.hash} />
      <TransactionViewContainer transactionHash={params.hash} />
    </Container>
  );
};

export default TransactionViewPage;

import { notFound } from 'next/navigation';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { TransactionViewContainer } from '@/pages/inspect/explorer/containers';
import { TxViewWithDecrypt } from '@/widgets/private-tx-view';
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
      {/* Public view, with a Decrypt toggle when the connected wallet took
          part in this transaction. */}
      <TxViewWithDecrypt txHash={params.hash}>
        <TransactionViewContainer transactionHash={params.hash} />
      </TxViewWithDecrypt>
    </Container>
  );
};

export default TransactionViewPage;

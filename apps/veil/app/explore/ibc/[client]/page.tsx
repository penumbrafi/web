import { notFound } from 'next/navigation';
import { FC } from 'react';
import {
  Breadcrumb,
  Breadcrumbs,
  Container,
  FilterSelector,
} from '@/pages/inspect/explorer/components';
import {
  ClientContainer,
  IbcFlowHistoryContainer,
  TransactionTableContainer,
} from '@/pages/inspect/explorer/containers';
import { IbcStatusFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types';
import ibc, { describeClient } from '@/pages/inspect/explorer/lib/ibc';
import { getClientChainIds } from '@/pages/inspect/explorer/lib/ibc/client-chains';
import { classNames, nonEmpty } from '@/pages/inspect/explorer/lib/utils';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ client: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}

const ClientPage: FC<Props> = async props => {
  const params = await props.params;
  // Match on slug OR id — links used to be slug-only (`/explore/ibc/injective`)
  // but current callers emit the client id (`/explore/ibc/07-tendermint-26`).
  // Without the id branch the resolver misses, and the page renders as
  // "Unknown" with no image or chainId.
  const bySlug = ibc.find(c => c.slug === params.client || c.id === params.client);
  const id = bySlug?.id ?? params.client;
  // Clients the hand-kept list doesn't know are named from the node's own
  // client state (its counterparty chain id), not shown as "Unknown".
  const client = bySlug ?? describeClient(id, (await getClientChainIds()).get(id));
  const name = client.name;

  const searchParams = await props.searchParams;
  const page = searchParams.page ? Number(searchParams.page) - 1 : 0;

  if (Number.isNaN(page) || page < 0) {
    notFound();
  }

  const length = 20;
  const offset = page * length;

  const ibcStatusMap: Record<string, IbcStatusFilter> = {
    completed: IbcStatusFilter.Completed,
    error: IbcStatusFilter.Error,
    expired: IbcStatusFilter.Expired,
    pending: IbcStatusFilter.Pending,
  };
  const ibcStatusFilter = ibcStatusMap[searchParams.filter ?? ''];

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb href='/explore/ibc'>IBC Chains</Breadcrumb>
      </Breadcrumbs>
      <IbcFlowHistoryContainer clientId={id} />
      <div
        className={classNames(
          'mt-4 grid items-start gap-4 lg:grid-cols-[300px_1fr]',
          'xl:grid-cols-[380px_1fr]',
        )}
      >
        <ClientContainer
          chainId={client.chainId}
          channelsClassName='lg:col-2 lg:row-1'
          id={id}
          // SVGR turns the .svg import into a component; ClientContainer typed
          // it as `string` upstream — cast through unknown to satisfy strict mode.
          image={client.image as unknown as string | undefined}
          name={name}
          statsClassName='lg:col-1 lg:row-span-2'
        />
        <TransactionTableContainer
          className='min-w-0'
          filter={{
            clientId: id,
            ...(ibcStatusFilter ? { ibcStatus: ibcStatusFilter } : {}),
          }}
          header={
            <div className='flex flex-col gap-6'>
              <h2 className={classNames('font-heading text-2xl font-medium lg:col-2', 'lg:row-2')}>
                Transactions
              </h2>
              <FilterSelector
                filters={['all', 'pending', 'completed', 'expired', 'error']}
                selectedFilter={nonEmpty(searchParams.filter) ?? 'all'}
              />
            </div>
          }
          limit={{ length, offset }}
          blockHeight
          pagination
          time
        />
      </div>
    </Container>
  );
};

export default ClientPage;

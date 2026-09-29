import Link from 'next/link';
import { ReactNode, memo, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { TransactionId } from '@penumbra-zone/protobuf/penumbra/core/txhash/v1/txhash_pb';
import { TransactionInfo } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { TransactionSummary } from '@penumbra-zone/ui/TransactionSummary';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { Text } from '@penumbra-zone/ui/Text';
import { uint8ArrayToHex } from '@penumbrafi/types/hex';
import { connectionStore } from '@/shared/model/connection';
import { useGetMetadata } from '@/shared/api/assets';
import { useLatestBlockHeight } from '@/shared/api/compact-block';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { useObserver } from '@/shared/utils/use-observer';
import TimeAgo from '@/pages/inspect/explorer/components/timeAgo';
import { blockSeconds } from '@/pages/inspect/explorer/lib/constants';
import { useTransactions } from '../api/use-transactions';
import { NoData } from './no-data';

const getTransactionLink = (id?: TransactionId) => {
  const hash = id?.inner ? uint8ArrayToHex(id.inner) : '';

  const TxLink = ({ children, ...rest }: { children?: ReactNode }) => (
    <Link href={`/explore/tx/${hash}`} {...rest}>
      {children}
    </Link>
  );
  TxLink.displayName = 'TxLink';

  return TxLink;
};

interface TransactionRowProps {
  tx: TransactionInfo;
  txTimestamp?: number;
  getMetadata: ReturnType<typeof useGetMetadata>;
}

const TransactionRow = memo(({ tx, txTimestamp, getMetadata }: TransactionRowProps) => {
  const Container = useMemo(() => getTransactionLink(tx.id), [tx.id]);

  return (
    <div className='relative'>
      <TransactionSummary info={tx} as={Container} getMetadata={getMetadata} />
      {txTimestamp && (
        <div className='pointer-events-none absolute top-3 right-3 z-10'>
          <Text detailTechnical color='text.secondary'>
            <TimeAgo timestamp={txTimestamp} />
          </Text>
        </div>
      )}
    </div>
  );
});
TransactionRow.displayName = 'TransactionRow';

export const PortfolioTransactions = observer(() => {
  const { subaccount } = connectionStore;
  const getMetadata = useGetMetadata();
  const {
    data: transactions,
    isLoading,
    error,
    isRefetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useTransactions(subaccount);

  // Approximate per-block timestamps: anchor "now" to the chain head and
  // walk back at the canonical block time. The view server doesn't expose
  // block times on TransactionInfo, and per-tx block lookups would amplify
  // RPC traffic linearly with history length.
  const { data: latestBlockHeight } = useLatestBlockHeight();
  const nowAtAnchor = useMemo(
    () => (latestBlockHeight ? Date.now() : undefined),
    [latestBlockHeight],
  );

  const { observerEl } = useObserver(
    isLoading || isRefetching || isFetchingNextPage || !hasNextPage,
    () => {
      void fetchNextPage();
    },
  );

  const getTxId = (tx: TransactionInfo): string => {
    return tx.id?.inner ? uint8ArrayToHex(tx.id.inner) : '';
  };

  return (
    <div className='flex flex-col gap-1' style={{ overflowAnchor: 'none' }}>
      {isLoading &&
        Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className='h-[72px]'>
            <Skeleton />
          </div>
        ))}

      {!isLoading && !!error && (
        <div className='flex min-h-[250px] items-center'>
          <BlockchainError direction='column' message={String(error)} hideDetails />
        </div>
      )}

      {!isLoading && !error && !transactions?.pages[0]?.length && (
        <NoData label='You have no transactions' />
      )}

      {transactions?.pages.map(page =>
        page.map((tx, index) => {
          const txTimestamp =
            latestBlockHeight && nowAtAnchor
              ? nowAtAnchor - (latestBlockHeight - Number(tx.height)) * blockSeconds * 1000
              : undefined;

          return (
            <TransactionRow
              key={getTxId(tx) || index}
              tx={tx}
              txTimestamp={txTimestamp}
              getMetadata={getMetadata}
            />
          );
        }),
      )}

      {/* An element that triggers the infinite scroll when visible */}
      <div className='h-1 w-full' ref={observerEl} />
    </div>
  );
});

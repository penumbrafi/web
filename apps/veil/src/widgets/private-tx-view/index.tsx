'use client';

import { ReactNode, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { ViewService } from '@penumbra-zone/protobuf';
import { TransactionId } from '@penumbra-zone/protobuf/penumbra/core/txhash/v1/txhash_pb';
import { TransactionInfo } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { hexToUint8Array } from '@penumbra-zone/types/hex';
import { ActionView } from '@penumbra-zone/ui/ActionView';
import { Density } from '@penumbra-zone/ui/Density';
import { Text } from '@penumbra-zone/ui/Text';
import { TransactionSummary } from '@penumbra-zone/ui/TransactionSummary';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useGetMetadata } from '@/shared/api/assets';

/**
 * Only a transaction this wallet took part in: it received outputs it can
 * decrypt (payload keys) or spent its own notes (nullifiers). For anyone
 * else's transaction the wallet still answers, with a mostly opaque view,
 * and offering to "decrypt" that would be wrong.
 */
const isOwn = (info: TransactionInfo): boolean =>
  (info.perspective?.payloadKeys.length ?? 0) > 0 ||
  (info.perspective?.spendNullifiers.length ?? 0) > 0;

const useOwnTxInfo = (txHash: string) => {
  const { connected } = connectionStore;
  const { data } = useQuery({
    queryKey: ['private-tx-view', txHash],
    enabled: connected && /^[0-9a-fA-F]{64}$/.test(txHash),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await penumbra.service(ViewService).transactionInfoByHash({
        id: new TransactionId({ inner: hexToUint8Array(txHash) }),
      });
      return res.txInfo ?? null;
    },
  });
  return data && isOwn(data) ? data : undefined;
};

/**
 * One transaction page, public by default. When the connected wallet took
 * part in the transaction, a Decrypt toggle switches the same page to the
 * wallet's view (amounts, assets, counterparties, memo) and back.
 * Decryption happens in the wallet; veil's server sees nothing new.
 *
 * `children` is the public view, rendered on the server.
 */
export const TxViewWithDecrypt = observer(
  ({ txHash, children }: { txHash: string; children: ReactNode }) => {
    const info = useOwnTxInfo(txHash);
    const getMetadata = useGetMetadata();
    const [decrypted, setDecrypted] = useState(false);

    if (!info) {
      return <>{children}</>;
    }

    const actions = info.view?.bodyView?.actionViews ?? [];

    return (
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between gap-3 rounded-lg bg-other-tonal-fill5 px-4 py-3'>
          <Text small color='text.secondary'>
            {decrypted
              ? 'Decrypted by your wallet. Only you can see this.'
              : 'This is your transaction. Your wallet can decrypt it.'}
          </Text>
          <button
            type='button'
            onClick={() => setDecrypted(d => !d)}
            aria-pressed={decrypted}
            className='flex items-center gap-1.5 rounded-sm bg-other-tonal-fill10 px-3 py-1.5 text-sm text-text-primary hover:bg-other-tonal-fill15'
          >
            {decrypted ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
            {decrypted ? 'Public view' : 'Decrypt'}
          </button>
        </div>

        {decrypted ? (
          <div className='flex flex-col gap-4'>
            <TransactionSummary info={info} getMetadata={getMetadata} />
            {actions.length > 0 && (
              <Density compact>
                <div className='flex flex-col gap-1'>
                  {actions.map((action, i) => (
                    <ActionView key={i} action={action} getMetadata={getMetadata} />
                  ))}
                </div>
              </Density>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    );
  },
);

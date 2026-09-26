'use client';

import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
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
 * and showing that as "your view" would be wrong.
 */
const isOwn = (info: TransactionInfo): boolean =>
  (info.perspective?.payloadKeys.length ?? 0) > 0 ||
  (info.perspective?.spendNullifiers.length ?? 0) > 0;

/**
 * Your decrypted view of a transaction, above the public explorer view.
 *
 * The public page can only show what is on chain: commitments, nullifiers,
 * encrypted payloads. The connected wallet can decrypt its own part
 * (amounts, assets, counterparties, memo), and the portfolio's transaction
 * list linked here, so opening your own transaction used to lose exactly
 * the details you clicked for. Decryption happens in the wallet; nothing is
 * sent to veil's server.
 */
export const PrivateTxView = observer(({ txHash }: { txHash: string }) => {
  const { connected } = connectionStore;
  const getMetadata = useGetMetadata();

  const { data: info } = useQuery({
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

  if (!info || !isOwn(info)) {
    return null;
  }

  const actions = info.view?.bodyView?.actionViews ?? [];

  return (
    <div className='mb-4 flex flex-col gap-4 rounded-lg border border-primary-main/30 bg-primary-main/5 p-4'>
      <div className='flex items-center gap-2'>
        <Lock className='h-4 w-4 text-primary-light' />
        <Text strong color='text.primary'>
          Your view
        </Text>
        <Text detail color='text.secondary'>
          Decrypted by your wallet. Only you can see this.
        </Text>
      </div>

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
  );
});

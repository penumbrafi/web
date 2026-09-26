import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { TransactionId } from '@penumbra-zone/protobuf/penumbra/core/txhash/v1/txhash_pb';
import { TransactionInfo } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { hexToUint8Array } from '@penumbra-zone/types/hex';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * Only a transaction this wallet took part in: it received outputs it can
 * decrypt (payload keys) or spent its own notes (nullifiers). For anyone
 * else's transaction the wallet still answers, with a mostly opaque view,
 * and offering to decrypt that would be wrong.
 */
const isOwn = (info: TransactionInfo): boolean =>
  (info.perspective?.payloadKeys.length ?? 0) > 0 ||
  (info.perspective?.spendNullifiers.length ?? 0) > 0;

/**
 * The connected wallet's view of a transaction, if it took part in it.
 * Decryption happens in the wallet; nothing goes to veil's server.
 * Must be used within the `observer` mobX HOC.
 */
export const useOwnTxInfo = (txHash: string): TransactionInfo | undefined => {
  const { connected } = connectionStore;
  const { data } = useQuery({
    queryKey: ['own-tx-info', txHash],
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

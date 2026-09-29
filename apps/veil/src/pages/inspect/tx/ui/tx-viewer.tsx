import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { TransactionInfo } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { uint8ArrayToHex } from '@penumbrafi/types/hex';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { ArrowRight } from 'lucide-react';

export const TxViewer = observer(({ txInfo }: { txInfo?: TransactionInfo }) => {
  const txId = txInfo?.id && uint8ArrayToHex(txInfo.id.inner);
  const explorerUrl = txId ? `/explore/tx/${txId}` : null;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2 text-text-primary'>
        <Text strong>Transaction View</Text>
        {txId && <Text technical>{txId}</Text>}
      </div>

      <div className='flex flex-col gap-4 rounded-sm bg-other-tonal-fill5 p-6 text-text-secondary'>
        <Text>
          See actions, memos, IBC details, and consensus parameters for this transaction on the
          chain explorer.
        </Text>

        {explorerUrl && (
          <div>
            <Link href={explorerUrl}>
              <Button priority='primary' icon={ArrowRight}>
                View on Explorer
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
});

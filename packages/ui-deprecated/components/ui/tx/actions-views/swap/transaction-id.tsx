import { TransactionId } from '@penumbra-zone/protobuf/penumbra/core/txhash/v1/txhash_pb';
import { Pill } from '../../../pill';
import { uint8ArrayToHex } from '@penumbrafi/types/hex';
import { shorten } from '@penumbrafi/types/string';

/**
 * Renders a SHA-256 hash of a transaction ID in a pill.
 */
export const TransactionIdComponent = ({ transactionId }: { transactionId: TransactionId }) => {
  const sha = uint8ArrayToHex(transactionId.inner);
  return (
    <Pill to={`/tx/${sha}`}>
      <span className='font-mono'>{shorten(sha, 8)}</span>
    </Pill>
  );
};

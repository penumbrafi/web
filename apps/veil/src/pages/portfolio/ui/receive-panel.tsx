'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { ViewService } from '@penumbra-zone/protobuf';
import { bech32mAddress } from '@penumbra-zone/bech32m/penumbra';
import { Text } from '@penumbra-zone/ui/Text';
import { CopyToClipboardButton } from '@penumbra-zone/ui/CopyToClipboardButton';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { Density } from '@penumbra-zone/ui/Density';
import { Button } from '@penumbra-zone/ui/Button';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * A one-time (ephemeral) address, never the account's static one: the
 * static address links every payment to it, and Zafu itself no longer
 * shows it. `nonce` rotates it on demand; gcTime 0 rotates it on every
 * remount.
 */
const useOneTimeAddress = (subaccount: number, nonce: number) =>
  useQuery({
    queryKey: ['portfolio-one-time-address', subaccount, nonce],
    enabled: connectionStore.connected,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async () => {
      const { address } = await penumbra.service(ViewService).ephemeralAddress({
        addressIndex: { account: subaccount },
      });
      if (!address) {
        throw new Error('view service returned no address for subaccount');
      }
      return bech32mAddress(address);
    },
  });

export const ReceivePanel = observer(() => {
  const { subaccount } = connectionStore;
  const [nonce, setNonce] = useState(0);
  const [showQr, setShowQr] = useState(false);
  const { data: address, isLoading, error } = useOneTimeAddress(subaccount, nonce);

  return (
    <div className='flex flex-col items-center gap-6 py-2'>
      <div className='flex flex-col gap-1'>
        <Text small color='text.secondary' align='center'>
          A one-time address for another Penumbra wallet to pay{' '}
          {subaccount === 0 ? 'your main account' : `sub-account ${subaccount}`}.
        </Text>
        <Text small color='caution.light' align='center'>
          Only send from Penumbra. Exchanges cannot send here - use Deposit instead.
        </Text>
      </div>

      {showQr && (
        <div className='flex h-[200px] w-[200px] items-center justify-center rounded-lg bg-white p-3'>
          {address ? (
            <QRCodeCanvas
              value={address}
              size={176}
              bgColor='#ffffff'
              fgColor='#000000'
              level='M'
            />
          ) : (
            <div className='h-full w-full'>
              <Skeleton />
            </div>
          )}
        </div>
      )}

      <div className='flex w-full flex-col gap-2'>
        <Text small color='text.secondary'>
          Address
        </Text>
        <div className='flex items-center gap-2 rounded-md bg-other-tonal-fill5 p-3'>
          <Text detailTechnical color='text.primary'>
            <span className='font-mono break-all'>{address ?? (isLoading ? 'Loading…' : '')}</span>
          </Text>
          <div className='ml-auto shrink-0'>
            <Density compact>
              <CopyToClipboardButton text={address ?? ''} disabled={!address} />
            </Density>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button density='compact' onClick={() => setNonce(n => n + 1)}>
            New address
          </Button>
          <Button density='compact' onClick={() => setShowQr(v => !v)}>
            {showQr ? 'Hide QR' : 'Show QR'}
          </Button>
        </div>
        {error && (
          <Text detail color='destructive.light'>
            {error.message}
          </Text>
        )}
      </div>
    </div>
  );
});

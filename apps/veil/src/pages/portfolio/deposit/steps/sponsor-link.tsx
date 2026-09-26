'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Check, Copy, RefreshCw, Share2 } from 'lucide-react';
import { ViewService } from '@penumbra-zone/protobuf';
import { bech32mAddress } from '@penumbra-zone/bech32m/penumbra';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';

/**
 * The no-wallet route: a deposit link that opens a page to send straight into
 * this account over IBC. The address is single-use (ephemeralAddress), so
 * the payer learns nothing that links to the main address, and it goes in
 * the URL fragment, which browsers never send to the server.
 */
export const SponsorLink = observer(({ onBack }: { onBack: () => void }) => {
  const { connected, subaccount } = connectionStore;
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  const { data: address, isLoading } = useQuery({
    // A new nonce is a new address; never share one link twice by accident.
    queryKey: ['sponsor-address', subaccount, nonce],
    enabled: connected,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const res = await penumbra.service(ViewService).ephemeralAddress({
        addressIndex: { account: subaccount },
      });
      if (!res.address) {
        throw new Error('The wallet returned no address');
      }
      return bech32mAddress(res.address);
    },
  });

  const link = address ? `${window.location.origin}/pay#${address}` : undefined;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className='flex flex-col gap-4'>
      <button
        type='button'
        onClick={onBack}
        className='flex w-fit items-center gap-1 text-text-secondary hover:text-text-primary'
      >
        <ArrowLeft className='h-3.5 w-3.5' />
        <Text small>Pick a wallet instead</Text>
      </button>

      <div className='flex flex-col gap-1'>
        <Text variant='strong' color='text.primary'>
          Deposit with a link
        </Text>
        <Text small color='text.secondary'>
          Open this link wherever the funds are, or send it to whoever is paying. It takes USDC,
          USDT or INJ from any Keplr or Leap wallet on Injective in one signature, and arrives here
          in about a minute.
        </Text>
      </div>

      {!connected && (
        <div className='flex flex-col items-start gap-3 rounded-xl bg-other-tonal-fill5 p-4'>
          <Text small color='text.secondary'>
            Connect your Penumbra wallet to make a link.
          </Text>
          <ConnectButton actionType='accent' />
        </div>
      )}

      {connected && (
        <div className='flex flex-col gap-3 rounded-xl bg-other-tonal-fill5 p-4'>
          <Text detail color='text.secondary'>
            Payment link
          </Text>
          {link && (
            // For opening the link on a phone, where the funds often are.
            <div className='w-fit rounded-sm bg-white p-2'>
              <QRCodeCanvas value={link} size={176} bgColor='#ffffff' fgColor='#000000' level='M' />
            </div>
          )}
          <div className='break-all'>
            <Text detailTechnical color='text.primary'>
              {isLoading || !link ? 'Making a fresh address…' : link}
            </Text>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              density='compact'
              actionType='accent'
              icon={copied ? Check : Copy}
              disabled={!link}
              onClick={() => {
                if (!link) {
                  return;
                }
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canShare && (
              <Button
                density='compact'
                priority='secondary'
                icon={Share2}
                disabled={!link}
                onClick={() => {
                  if (link) {
                    void navigator.share({ title: 'Pay me on Penumbra', url: link }).catch(() => {
                      // dismissed share sheet: nothing to do
                    });
                  }
                }}
              >
                Share
              </Button>
            )}
            <Button
              density='compact'
              priority='secondary'
              icon={RefreshCw}
              onClick={() => setNonce(n => n + 1)}
            >
              New link
            </Button>
          </div>
          <Text detail color='text.secondary'>
            The address is single-use and not linked to your main Penumbra address. Anyone with the
            link can pay into this account, so make a new one for each payer.
          </Text>
        </div>
      )}
    </div>
  );
});

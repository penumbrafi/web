'use client';

import { useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { Check, Copy } from 'lucide-react';
import { useDepositAddress } from './use-deposit-address';
import type { ManualDepositRoute } from './deposit-method-picker';

interface ManualIbcDepositProps {
  route: ManualDepositRoute;
}

/**
 * Deposit panel for source chains the Skip widget cannot route to Penumbra.
 *
 * Skip resolves a destination by denom, and it only knows Penumbra's
 * channel-2 (Noble) assets — a route request for an Injective-sourced denom
 * comes back `Dest token not found`. Rather than hand the user a widget that
 * dead-ends, we show the ephemeral Penumbra deposit address and let them send
 * a plain ICS-20 transfer from their own wallet on the source chain.
 *
 * The address comes from `useDepositAddress`, so it is the same one-shot
 * bech32m the Skip path uses: two deposits are not linkable to one subaccount.
 */
export const ManualIbcDeposit = ({ route }: ManualIbcDepositProps) => {
  const { data: penumbraAddress, isLoading, error, fetchStatus } = useDepositAddress();

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <Text variant='strong' color='text.primary'>
          Deposit from {route.label}
        </Text>
        <Text small color='text.secondary'>
          Send an IBC transfer from your {route.label} wallet to the address below, over{' '}
          <span className='font-mono'>{route.srcChannelId}</span> ({route.label} → penumbra-1). It
          arrives as a shielded balance.
        </Text>
      </div>

      <AddressBox
        address={penumbraAddress}
        isLoading={isLoading}
        hasError={Boolean(error)}
        isDisconnected={!isLoading && !penumbraAddress && fetchStatus === 'idle'}
      />

      <div className='flex flex-col gap-1'>
        <Text detail color='text.secondary'>
          Supported here: {route.assetsHint}
        </Text>
        <Text detail color='text.secondary'>
          The address is single-use — reopen this dialog for a fresh one. Use a wallet that can send
          an IBC transfer to Penumbra; the recipient field must hold the full address above.
        </Text>
      </div>
    </div>
  );
};

const AddressBox = ({
  address,
  isLoading,
  hasError,
  isDisconnected,
}: {
  address?: string;
  isLoading: boolean;
  hasError: boolean;
  /** The address query is gated on a Penumbra connection; when it never runs
   *  tanstack reports idle rather than loading, which would otherwise leave
   *  the skeleton spinning with no explanation. */
  isDisconnected: boolean;
}) => {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    if (!address) {
      return;
    }
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (isDisconnected) {
    return (
      <Text small color='text.secondary'>
        Connect your Penumbra wallet to generate a deposit address.
      </Text>
    );
  }

  if (hasError) {
    return (
      <Text small color='destructive.light'>
        Could not generate a deposit address. Reconnect your wallet and try again.
      </Text>
    );
  }

  if (isLoading || !address) {
    return (
      <div className='h-20 w-full animate-pulse rounded-lg bg-other-tonal-fill5' aria-hidden />
    );
  }

  return (
    <div className='flex items-start gap-3 rounded-lg bg-other-tonal-fill5 p-3'>
      <span className='min-w-0 flex-1 font-mono text-xs break-all text-text-primary'>
        {address}
      </span>
      <button
        type='button'
        onClick={onCopy}
        aria-label='Copy deposit address'
        className='shrink-0 rounded-md p-1.5 text-text-secondary transition-colors hover:bg-other-tonal-fill10 hover:text-text-primary'
      >
        {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
      </button>
    </div>
  );
};

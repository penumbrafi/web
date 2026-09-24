'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useChain } from '@cosmos-kit/react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { getMetadata } from '@penumbra-zone/getters/value-view';

import type { Chain } from '@penumbrafi/registry';
import { useRegistry } from '@/shared/api/registry.tsx';
import { SUPPORTED_CHAINS } from '@/features/cosmos/supported-chains';
import { unknownAddrIsValid } from '@/pages/portfolio/withdraw/lib/ics20-withdraw';
import type { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets';

interface DestinationStepProps {
  balance: ShieldedBalance;
  initialAddress: string;
  onBack: () => void;
  onNext: (address: string, chain: Chain) => void;
}


export function DestinationStep({
  balance,
  initialAddress,
  onBack,
  onNext,
}: DestinationStepProps) {
  const { data: registry } = useRegistry();

  const metadata = getMetadata.optional(balance.valueView);
  const symbol = metadata?.symbol ?? '';
  const channelId = metadata?.base.split('/')[1] ?? '';

  const destinationChain = useMemo(
    () => registry.ibcConnections.find(c => c.channelId === channelId),
    [registry, channelId],
  );

  // Resolve the cosmos-kit chain_name slug from the Penumbra chainId
  // (e.g. `injective-1` -> `injective`). `useChain` needs a slug that
  // was registered on ChainProvider; if we can't resolve one, fall back
  // to a harmless supported chain so the hook stays stable — we gate on
  // `chainName` below before reading anything real from `chain`.
  const chainName = useMemo(() => {
    if (!destinationChain) return null;
    return (
      SUPPORTED_CHAINS.find(c => c.chain_id === destinationChain.chainId)?.chain_name ?? null
    );
  }, [destinationChain]);

  const fallbackSlug = SUPPORTED_CHAINS[0]?.chain_name ?? 'noble';
  const chain = useChain(chainName ?? fallbackSlug);
  const cosmosAddress = chainName && chain.isWalletConnected ? chain.address : undefined;

  const [address, setAddress] = useState(initialAddress);
  const [touched, setTouched] = useState(false);

  // Pre-fill on first mount if the user has a Keplr address on this chain
  // AND hasn't already typed something.
  useEffect(() => {
    if (!address && cosmosAddress) {
      setAddress(cosmosAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmosAddress]);

  const isValid = unknownAddrIsValid(destinationChain, address);

  const chainImage = destinationChain?.images[0]?.png ?? '';
  const chainDisplay = destinationChain?.displayName ?? 'Unknown';

  return (
    <div className='flex flex-col gap-4'>
      <Text variant='body' color='text.primary'>
        Network
      </Text>
      <TextInput
        disabled
        value={chainDisplay}
        startAdornment={
          chainImage ? (
            <Image width={24} height={24} src={chainImage} alt={chainDisplay} />
          ) : undefined
        }
      />
      <Text variant='detail' color='text.secondary'>
        {symbol} can only be withdrawn to its source chain ({chainDisplay}).
      </Text>

      <div className='flex items-center justify-between'>
        <Text variant='body' color='text.primary'>
          Destination address
        </Text>
        {cosmosAddress && (
          <button
            type='button'
            onClick={() => {
              setAddress(cosmosAddress);
              setTouched(true);
            }}
            className='text-xs text-primary-light hover:underline focus:outline-none'
          >
            Use my Keplr address
          </button>
        )}
      </div>
      <TextInput
        placeholder={`Paste your ${chainDisplay} address (${destinationChain?.addressPrefix ?? ''}1…)`}
        value={address}
        actionType={!touched || isValid ? 'default' : 'destructive'}
        onChange={val => {
          setAddress(val);
          setTouched(true);
        }}
      />
      {touched && address !== '' && !isValid && (
        <Text variant='detail' color='destructive.main'>
          Not a valid {chainDisplay} address.
        </Text>
      )}

      {/* This withdrawal is a raw ICS-20 transfer and CANNOT carry a memo:
          `Ics20Withdrawal` has seven fields and none of them is one, and the
          Penumbra transaction memo is `MemoCiphertext` — encrypted to the
          recipient's viewing key, invisible off-chain. Most exchanges credit
          a deposit by its memo/tag, so a direct transfer here can arrive
          uncredited and unrecoverable.

          There used to be Binance / Kraken / OKX / Bybit / Coinbase chips
          here. They steered users into exactly that. Removed rather than
          re-worded: no wording makes the direct path correct, because the
          field the exchange needs does not exist in the protocol. */}
      <div className='rounded-md border border-caution-main/40 bg-caution-main/10 p-3'>
        <Text variant='detail' color='caution.light'>
          Withdraw to an address you control — not an exchange deposit address.
          This transfer cannot carry a memo or tag, and most exchanges need one
          to credit your deposit; without it funds can arrive uncredited. To
          reach an exchange, withdraw to your own wallet on {chainDisplay}
          first, then send from there with the memo.
        </Text>
      </div>

      <div className='rounded-md border border-caution-main/40 bg-caution-main/10 p-3'>
        <Text variant='detail' color='caution.light'>
          Only send to an address that supports the {chainDisplay} network. Funds sent to an incompatible address may be lost.
        </Text>
      </div>

      <div className='mt-2 flex items-center justify-between gap-2'>
        <Button priority='secondary' onClick={onBack}>
          Back
        </Button>
        <Button
          priority='primary'
          disabled={!isValid || !destinationChain}
          onClick={() => {
            if (destinationChain && isValid) {
              onNext(address, destinationChain);
            }
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

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

// Common exchanges users typically withdraw to. This list only powers a
// labelling helper — nothing about a chip choice authorizes or transmits
// funds; the user still pastes their own deposit address.
const EXCHANGE_CHIPS = [
  { id: 'binance', label: 'Binance' },
  { id: 'kraken', label: 'Kraken' },
  { id: 'okx', label: 'OKX' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'coinbase', label: 'Coinbase' },
] as const;

type ExchangeId = (typeof EXCHANGE_CHIPS)[number]['id'];

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
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId | null>(null);
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
              setSelectedExchange(null);
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

      <div className='flex flex-col gap-2'>
        <Text variant='detail' color='text.secondary'>
          Sending to an exchange?
        </Text>
        <div className='flex flex-wrap gap-2'>
          {EXCHANGE_CHIPS.map(ex => {
            const active = selectedExchange === ex.id;
            return (
              <button
                key={ex.id}
                type='button'
                onClick={() => setSelectedExchange(active ? null : ex.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-main ${
                  active
                    ? 'border-primary-main bg-primary-main/20 text-primary-light'
                    : 'border-other-tonal-stroke text-text-secondary hover:bg-other-tonal-fill5'
                }`}
              >
                {ex.label}
              </button>
            );
          })}
        </div>
        {selectedExchange && (
          <Text variant='detail' color='text.secondary'>
            Paste your {EXCHANGE_CHIPS.find(e => e.id === selectedExchange)?.label} {symbol} deposit address for the {chainDisplay} network here — not an address from another network.
          </Text>
        )}
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

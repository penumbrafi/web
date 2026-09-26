'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import BigNumber from 'bignumber.js';
import { useChain } from '@cosmos-kit/react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { getMetadata } from '@penumbra-zone/getters/value-view';
import { pnum } from '@penumbra-zone/types/pnum';

import type { Chain } from '@penumbrafi/registry';
import { useRegistry } from '@/shared/api/registry.tsx';
import { SUPPORTED_CHAINS } from '@/features/cosmos/supported-chains';
import {
  amountMoreThanBalance,
  unknownAddrIsValid,
} from '@/pages/portfolio/withdraw/lib/ics20-withdraw';
import { useWithdrawChannels } from '@/pages/portfolio/withdraw/lib/use-withdraw-channels';
import type { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets';

interface DestinationStepProps {
  balance: ShieldedBalance;
  initialAddress: string;
  initialAmount: string;
  onBack: () => void;
  onNext: (address: string, chain: Chain, amount: string) => void;
}

export function DestinationStep({
  balance,
  initialAddress,
  initialAmount,
  onBack,
  onNext,
}: DestinationStepProps) {
  const { data: registry } = useRegistry();

  const metadata = getMetadata.optional(balance.valueView);
  const symbol = metadata?.symbol ?? '';
  // an asset that came in over IBC goes back where it came from; UM (native,
  // no denom trace) can go out over any channel that's live right now
  const tracedChannelId = metadata?.base.startsWith('transfer/')
    ? metadata.base.split('/')[1]
    : undefined;
  const isNative = tracedChannelId === undefined;
  const { data: liveChains, isLoading: liveChainsLoading } = useWithdrawChannels();
  const [pickedChannelId, setPickedChannelId] = useState<string>();
  const channelId = tracedChannelId ?? pickedChannelId ?? liveChains?.[0]?.channelId ?? '';

  const destinationChain = useMemo(
    () =>
      isNative
        ? liveChains?.find(c => c.channelId === channelId)
        : registry.ibcConnections.find(c => c.channelId === channelId),
    [isNative, liveChains, registry, channelId],
  );

  // Resolve the cosmos-kit chain_name slug from the Penumbra chainId
  // (e.g. `injective-1` -> `injective`). `useChain` needs a slug that
  // was registered on ChainProvider; if we can't resolve one, fall back
  // to a harmless supported chain so the hook stays stable - we gate on
  // `chainName` below before reading anything real from `chain`.
  const chainName = useMemo(() => {
    if (!destinationChain) {
      return null;
    }
    return SUPPORTED_CHAINS.find(c => c.chain_id === destinationChain.chainId)?.chain_name ?? null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill only when the connected address changes, never over what the user typed
  }, [cosmosAddress]);

  const isValid = unknownAddrIsValid(destinationChain, address);

  // Amount lives on this step so the user always sees what they are about
  // to send before continuing. It starts empty (or the value they already
  // typed) - never the full balance. Max is an explicit action.
  const maxDisplay = useMemo(() => pnum(balance.valueView).toString(), [balance.valueView]);
  const [amount, setAmount] = useState(initialAmount);

  const tooBig = amount !== '' && amountMoreThanBalance(balance.balance, amount);
  const isPositive =
    amount !== '' &&
    (() => {
      try {
        return new BigNumber(amount).isFinite() && new BigNumber(amount).gt(0);
      } catch {
        return false;
      }
    })();
  const amountValid = isPositive && !tooBig;

  const chainImage = destinationChain?.images[0]?.png ?? '';
  const chainDisplay = destinationChain?.displayName ?? 'Unknown';

  // The primary button states exactly what happens next, or why it can't.
  let buttonLabel = `Withdraw ${amount} ${symbol}`;
  // an OPEN channel whose light client has expired takes the funds and never
  // delivers them, so a returning asset needs its channel live too
  const channelLive = !!liveChains?.some(c => c.channelId === channelId);
  if (liveChainsLoading) {
    buttonLabel = 'Checking channels...';
  } else if (!destinationChain) {
    buttonLabel = 'Unsupported network';
  } else if (!channelLive) {
    buttonLabel = `${chainDisplay} channel is down`;
  } else if (address === '') {
    buttonLabel = 'Enter destination address';
  } else if (!isValid) {
    buttonLabel = 'Invalid address';
  } else if (amount === '') {
    buttonLabel = 'Enter amount';
  } else if (tooBig) {
    buttonLabel = 'Insufficient balance';
  } else if (!isPositive) {
    buttonLabel = 'Invalid amount';
  }
  const canSubmit = !!destinationChain && channelLive && isValid && amountValid;

  return (
    <div className='flex flex-col gap-4'>
      <Text variant='body' color='text.primary'>
        Network
      </Text>
      {isNative ? (
        <div className='flex items-center gap-2 rounded-sm bg-other-tonal-fill5 px-3 py-2'>
          {chainImage && <Image width={24} height={24} src={chainImage} alt={chainDisplay} />}
          <select
            aria-label='Destination network'
            value={channelId}
            disabled={liveChainsLoading || !liveChains?.length}
            onChange={e => {
              setPickedChannelId(e.target.value);
              setAddress('');
              setTouched(false);
            }}
            className='flex-1 bg-transparent text-text-primary outline-none'
          >
            {liveChainsLoading && <option value=''>Checking channels...</option>}
            {!liveChainsLoading && !liveChains?.length && (
              <option value=''>No open channels right now</option>
            )}
            {liveChains?.map(c => (
              <option key={c.channelId} value={c.channelId}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
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
        </>
      )}

      <div className='flex items-center justify-between'>
        <Text variant='body' color='text.primary'>
          Destination address
        </Text>
        {cosmosAddress ? (
          <button
            type='button'
            onClick={() => {
              setAddress(cosmosAddress);
              setTouched(true);
            }}
            className='text-xs text-primary-light hover:underline focus:outline-none'
          >
            Use my {chain.wallet?.prettyName ?? 'wallet'} address
          </button>
        ) : (
          chainName && (
            // Opens the wallet picker (Zafu, Keplr, Leap); the effect above
            // fills the address in once it connects.
            <button
              type='button'
              disabled={chain.isWalletConnecting}
              onClick={() => chain.openView()}
              className='text-xs text-primary-light hover:underline focus:outline-none disabled:opacity-50'
            >
              {chain.isWalletConnecting ? 'Connecting…' : `Connect a ${chainDisplay} wallet`}
            </button>
          )
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
          Penumbra transaction memo is `MemoCiphertext` - encrypted to the
          recipient's viewing key, invisible off-chain. Most exchanges credit
          a deposit by its memo/tag, so a direct transfer here can arrive
          uncredited and unrecoverable.

          There used to be Binance / Kraken / OKX / Bybit / Coinbase chips
          here. They steered users into exactly that. Removed rather than
          re-worded: no wording makes the direct path correct, because the
          field the exchange needs does not exist in the protocol. */}
      <Text variant='body' color='text.primary'>
        Amount
      </Text>
      <TextInput
        placeholder='0.0'
        value={amount}
        actionType={amount === '' || !tooBig ? 'default' : 'destructive'}
        endAdornment={
          <div className='flex items-center gap-2 pr-2'>
            <Text variant='detail' color='text.secondary'>
              {symbol}
            </Text>
            <button
              type='button'
              onClick={() => setAmount(maxDisplay)}
              className='rounded-md border border-primary-main/50 px-2 py-0.5 text-xs text-primary-light hover:bg-primary-main/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-main'
            >
              Max
            </button>
          </div>
        }
        onChange={val => setAmount(val)}
      />
      <div className='flex items-center justify-between'>
        <Text variant='detail' color='text.secondary'>
          Available: {maxDisplay} {symbol}
        </Text>
        {tooBig && (
          <Text variant='detail' color='destructive.main'>
            Insufficient balance
          </Text>
        )}
      </div>
      <Text variant='detail' color='text.secondary'>
        Fees are paid separately; the full amount arrives on {chainDisplay}.
      </Text>

      <div className='flex flex-col gap-1 rounded-md border border-caution-main/40 bg-caution-main/10 p-3'>
        <Text variant='detail' color='caution.light'>
          Only send to a {chainDisplay} address. Other networks may lose funds.
        </Text>
        <Text variant='detail' color='caution.light'>
          This transfer can&apos;t carry a memo: withdraw to your own wallet, not an exchange
          deposit address, then forward from there.
        </Text>
      </div>

      <div className='mt-2 flex items-center justify-between gap-2'>
        <Button priority='secondary' onClick={onBack}>
          Back
        </Button>
        <Button
          priority='primary'
          disabled={!canSubmit}
          onClick={() => {
            if (destinationChain && canSubmit) {
              onNext(address, destinationChain, amount);
            }
          }}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

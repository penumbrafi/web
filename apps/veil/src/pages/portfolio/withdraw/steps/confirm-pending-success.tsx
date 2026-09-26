'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { getDisplayDenomExponentFromValueView, getMetadata } from '@penumbra-zone/getters/value-view';
import { pnum } from '@penumbra-zone/types/pnum';
import { uint8ArrayToHex } from '@penumbra-zone/types/hex';

import type { Chain } from '@penumbrafi/registry';
import { sendIbcOut } from '@/pages/portfolio/withdraw/lib/ics20-withdraw';
import type { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets';

interface ConfirmPendingSuccessProps {
  balance: ShieldedBalance;
  destinationChain: Chain;
  address: string;
  amount: string;
  onBack: () => void;
  onDone: () => void;
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'pending'; message: string }
  | { kind: 'success'; txHash: string }
  | { kind: 'error'; message: string; mayBeOnChain: boolean };

function truncateMiddle(s: string, keep = 8): string {
  if (s.length <= keep * 2 + 3) {return s;}
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

export function ConfirmPendingSuccess({
  balance,
  destinationChain,
  address,
  amount,
  onBack,
  onDone,
}: ConfirmPendingSuccessProps) {
  const metadata = getMetadata.optional(balance.valueView);
  const symbol = metadata?.symbol ?? '';
  const chainImage = destinationChain.images[0]?.png ?? '';

  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });

  const submit = () => {
    void (async () => {
      setPhase({ kind: 'pending', message: 'Approve the withdrawal in your wallet' });
      try {
        // `sendIbcOut` expects display-denomination amount; normalize with
        // pnum + exponent to match the per-row unshield path.
        const normalized = pnum(
          amount,
          getDisplayDenomExponentFromValueView(balance.valueView),
        ).toString();
        // Nothing is emitted until sendIbcOut has planned, built, been
        // approved and broadcast; the old "Packet emitted" line was shown
        // before any of that happened.
        const result = await sendIbcOut(
          balance,
          normalized,
          address,
          destinationChain.channelId,
        );
        // `planBuildBroadcast` may return `undefined` on user cancellation.
        if (!result) {
          setPhase({ kind: 'confirm' });
          return;
        }
        // Derive tx hash from the built transaction. We can't cheaply
        // reuse the hash computed inside planBuildBroadcast without an
        // API change, so recompute it here.
        const { txToId } = await import('@/entities/transaction/model/tx-to-id');
        const txHash = uint8ArrayToHex((await txToId(result.transaction)).inner);
        setPhase({ kind: 'success', txHash });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // planBuildBroadcast attaches `described`; txAlreadyOnChain means
        // the bytes may have landed. Offering Retry then risks sending the
        // same amount out twice.
        const described = (e as { described?: { txAlreadyOnChain?: boolean } }).described;
        setPhase({ kind: 'error', message: msg, mayBeOnChain: Boolean(described?.txAlreadyOnChain) });
      }
    })();
  };

  if (phase.kind === 'pending') {
    return (
      <div className='flex flex-col items-center gap-4 py-12 text-center'>
        <Loader2 className='h-8 w-8 animate-spin text-primary-light' />
        <Text variant='large' color='text.primary'>
          Withdrawing {amount} {symbol}
        </Text>
        <Text variant='small' color='text.secondary'>
          {phase.message}
        </Text>
      </div>
    );
  }

  if (phase.kind === 'success') {
    return (
      <div className='flex flex-col items-center gap-4 py-8 text-center'>
        <Text variant='large' color='text.primary'>
          Withdrawal submitted
        </Text>
        <Text variant='small' color='text.secondary'>
          {amount} {symbol} is on its way to {destinationChain.displayName}. It usually arrives in
          about a minute.
        </Text>
        <div className='rounded-md border border-other-tonal-stroke bg-other-tonal-fill5 px-3 py-2'>
          <Link
            href={`/explore/tx/${phase.txHash}`}
            className='font-mono text-xs text-primary-light hover:underline'
          >
            {truncateMiddle(phase.txHash, 10)}
          </Link>
        </div>
        <Link href='/portfolio'>
          <Button priority='primary' onClick={onDone}>
            Return to portfolio
          </Button>
        </Link>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className='flex flex-col items-center gap-4 py-8 text-center'>
        <Text variant='large' color='destructive.light'>
          Withdrawal failed
        </Text>
        <Text variant='small' color='destructive.main'>
          {phase.message}
        </Text>
        {phase.mayBeOnChain && (
          <Text variant='small' color='text.secondary'>
            This withdrawal may already be on chain. Check History on your portfolio before trying
            again, or the same amount could go out twice.
          </Text>
        )}
        <div className='flex gap-2'>
          <Button priority='secondary' onClick={onBack}>
            Back
          </Button>
          {!phase.mayBeOnChain && (
            <Button priority='primary' onClick={submit}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  // confirm
  return (
    <div className='flex flex-col gap-4'>
      <Text variant='body' color='text.primary'>
        Review withdrawal
      </Text>

      <div className='flex flex-col gap-3 rounded-lg border border-other-tonal-stroke bg-other-tonal-fill5 p-4'>
        <Row label='Asset' value={`${amount} ${symbol}`} />
        <Row
          label='Network'
          value={
            <div className='flex items-center gap-2'>
              {chainImage && (
                <Image
                  width={18}
                  height={18}
                  src={chainImage}
                  alt={destinationChain.displayName}
                />
              )}
              <Text variant='detail' color='text.primary'>
                {destinationChain.displayName}
              </Text>
            </div>
          }
        />
        <Row
          label='To'
          value={
            <span className='font-mono text-xs text-text-primary' title={address}>
              {truncateMiddle(address, 10)}
            </span>
          }
        />
        <Row label='Estimated arrival' value='~1 minute' />
      </div>

      <Text variant='detail' color='text.secondary'>
        Also known as unshielding. Once submitted, this cannot be reversed.
      </Text>

      <div className='mt-2 flex items-center justify-between gap-2'>
        <Button priority='secondary' onClick={onBack}>
          Back
        </Button>
        <Button priority='primary' onClick={submit}>
          Confirm withdrawal
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-start justify-between gap-3'>
      <Text variant='detail' color='text.secondary'>
        {label}
      </Text>
      <div className='text-right'>
        {typeof value === 'string' ? (
          <Text variant='detail' color='text.primary'>
            {value}
          </Text>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

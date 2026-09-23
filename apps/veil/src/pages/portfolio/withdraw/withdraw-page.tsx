'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';

import type { Chain } from '@penumbrafi/registry';
import { useRegistry } from '@/shared/api/registry.tsx';
import type {
  ShieldedBalance,
  UnifiedAsset,
} from '@/pages/portfolio/api/use-unified-assets';

import { AssetSelectStep } from './steps/asset-select';
import { DestinationStep } from './steps/destination';
import { AmountStep } from './steps/amount';
import { ConfirmPendingSuccess } from './steps/confirm-pending-success';

// `useChain` from cosmos-kit must run under `<ChainProvider>`. The
// portfolio route already wires that provider via `IbcChainProvider` in
// the desktop page — reuse the same wrapper here so the destination
// step can read the user's connected Keplr/Leap address on the source
// chain.
const IbcChainProviderClient = dynamic(
  () => import('@/features/cosmos/chain-provider').then(m => ({ default: m.IbcChainProvider })),
  { ssr: false },
);

type Step = 'asset' | 'destination' | 'amount' | 'confirm';

export const WithdrawPage = observer(() => {
  const { data: registry } = useRegistry();

  return (
    <IbcChainProviderClient registry={registry}>
      <div className='container mx-auto max-w-lg px-4 py-8 sm:py-12'>
        <div className='mb-4'>
          <Link
            href='/portfolio'
            className='inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus:outline-none'
          >
            <ArrowLeft className='h-4 w-4' />
            Portfolio
          </Link>
        </div>

        <div className='rounded-2xl border border-other-tonal-stroke bg-other-tonal-fill5 p-4 backdrop-blur-lg sm:p-6'>
          <div className='mb-4'>
            <Text variant='xxl' color='text.primary'>
              Withdraw
            </Text>
            <Text variant='detail' color='text.secondary'>
              Send shielded funds out to an exchange or a Cosmos wallet.
              (Also known as unshielding.)
            </Text>
          </div>

          <WithdrawFlow />
        </div>
      </div>
    </IbcChainProviderClient>
  );
});

function WithdrawFlow() {
  const [step, setStep] = useState<Step>('asset');
  const [asset, setAsset] = useState<UnifiedAsset | null>(null);
  const [balance, setBalance] = useState<ShieldedBalance | null>(null);
  const [destChain, setDestChain] = useState<Chain | null>(null);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');

  if (step === 'asset' || !balance) {
    return (
      <AssetSelectStep
        onSelect={(a, b) => {
          setAsset(a);
          setBalance(b);
          setAddress('');
          setAmount('');
          setDestChain(null);
          setStep('destination');
        }}
      />
    );
  }

  if (step === 'destination') {
    return (
      <DestinationStep
        balance={balance}
        initialAddress={address}
        onBack={() => setStep('asset')}
        onNext={(addr, chain) => {
          setAddress(addr);
          setDestChain(chain);
          setStep('amount');
        }}
      />
    );
  }

  if (step === 'amount') {
    return (
      <AmountStep
        balance={balance}
        initialAmount={amount}
        onBack={() => setStep('destination')}
        onNext={amt => {
          setAmount(amt);
          setStep('confirm');
        }}
      />
    );
  }

  if (step === 'confirm' && destChain) {
    return (
      <ConfirmPendingSuccess
        balance={balance}
        destinationChain={destChain}
        address={address}
        amount={amount}
        onBack={() => setStep('amount')}
        onDone={() => {
          // Reset for a hypothetical "withdraw another" — the success
          // screen navigates away via the "Return to portfolio" Link,
          // so this only runs if someone wires an in-place reset.
          setStep('asset');
          setAsset(null);
          setBalance(null);
          setDestChain(null);
          setAddress('');
          setAmount('');
        }}
      />
    );
  }

  // Fallback: shouldn't hit this in practice.
  void asset;
  return null;
}

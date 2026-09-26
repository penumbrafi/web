'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Dialog } from '@penumbra-zone/ui/Dialog';

import type { Chain } from '@penumbrafi/registry';
import { useRegistry } from '@/shared/api/registry.tsx';
import type { ShieldedBalance, UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets';

import { AssetSelectStep } from './steps/asset-select';
import { DestinationStep } from './steps/destination';
import { ConfirmPendingSuccess } from './steps/confirm-pending-success';

// `useChain` from cosmos-kit must run under `<ChainProvider>`. The
// portfolio route already wires that provider via `IbcChainProvider` in
// the desktop page - reuse the same wrapper here so the destination
// step can read the user's connected Keplr/Leap address on the source
// chain.
const IbcChainProviderClient = dynamic(
  () => import('@/features/cosmos/chain-provider').then(m => ({ default: m.IbcChainProvider })),
  { ssr: false },
);

type Step = 'asset' | 'destination' | 'confirm';

/**
 * `/portfolio/withdraw`: a dialog over the portfolio (the portfolio itself is
 * rendered by `app/portfolio/layout.tsx`), so the URL is shareable and closing
 * it just goes back to `/portfolio`.
 */
export const WithdrawModal = observer(() => {
  const { data: registry } = useRegistry();
  const router = useRouter();

  return (
    <Dialog isOpen onClose={() => router.push('/portfolio')}>
      <Dialog.Content title='Withdraw'>
        <IbcChainProviderClient registry={registry}>
          <WithdrawFlow />
        </IbcChainProviderClient>
      </Dialog.Content>
    </Dialog>
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
        initialAmount={amount}
        onBack={() => setStep('asset')}
        onNext={(addr, chain, amt) => {
          setAddress(addr);
          setDestChain(chain);
          setAmount(amt);
          setStep('confirm');
        }}
      />
    );
  }

  if (destChain) {
    return (
      <ConfirmPendingSuccess
        balance={balance}
        destinationChain={destChain}
        address={address}
        amount={amount}
        onBack={() => setStep('destination')}
        onDone={() => {
          // Reset for a hypothetical "withdraw another" - the success
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

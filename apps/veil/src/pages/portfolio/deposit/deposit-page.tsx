'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { observer } from 'mobx-react-lite';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { useRegistry } from '@/shared/api/registry';
import { IbcChainProvider } from '@/features/cosmos/chain-provider';
import type { CexAsset, CexConfig } from '@/features/deposit/cex-config';
import { DepositHeader } from './steps/deposit-header';
import { MethodSelect } from './steps/method-select';
import { CexAssetSelect } from './steps/cex-asset-select';
import { DepositPanel } from './steps/deposit-panel';
import { WalletSource } from './steps/ready-to-shield';
import { ArrivalWallet } from './steps/arrival-wallet';
import { SponsorLink } from './steps/sponsor-link';
import { useChain } from '@cosmos-kit/react';

type Step =
  | { name: 'method' }
  | { name: 'cex-asset' }
  | { name: 'wallet' }
  | { name: 'sponsor' }
  | { name: 'deposit'; cex: CexConfig; asset: CexAsset };

/**
 * `/portfolio/deposit`: a dialog over the portfolio (the portfolio itself is
 * rendered by `app/portfolio/layout.tsx`), so the URL is shareable and closing
 * it just goes back to `/portfolio`. Wrapped in `IbcChainProvider` so the
 * one-click shield on the final step can call `useChain(...)`.
 */
export const DepositModal = observer(() => {
  const { data: registry } = useRegistry();
  const router = useRouter();
  return (
    <Dialog isOpen onClose={() => router.push('/portfolio')}>
      <Dialog.Content title='Deposit'>
        <IbcChainProvider registry={registry}>
          <DepositFlow />
        </IbcChainProvider>
      </Dialog.Content>
    </Dialog>
  );
});

const DepositFlow = observer(() => {
  const [step, setStep] = useState<Step>({ name: 'method' });
  // Everything below lands in this wallet first, so it is step one: with a
  // wallet the page shows its balances and address; without one there is
  // nothing to deposit to yet.
  const { isWalletConnected } = useChain('injective');

  const crumbs = (() => {
    switch (step.name) {
      case 'method':
        return [{ label: 'Choose a source' }];
      case 'cex-asset':
        return [
          { label: 'From an exchange', onClick: () => setStep({ name: 'method' }) },
          { label: 'Pick asset' },
        ];
      case 'sponsor':
        return [
          { label: 'Choose a source', onClick: () => setStep({ name: 'method' }) },
          { label: 'Deposit link' },
        ];
      case 'wallet':
        return [
          { label: 'Choose a source', onClick: () => setStep({ name: 'method' }) },
          { label: 'Already in this wallet' },
        ];
      case 'deposit':
        return [
          { label: 'From an exchange', onClick: () => setStep({ name: 'method' }) },
          { label: step.cex.name, onClick: () => setStep({ name: 'cex-asset' }) },
          { label: `${step.asset.symbol} on ${step.asset.network}` },
        ];
    }
  })();

  return (
    <div className='flex flex-col gap-5'>
      <DepositHeader crumbs={crumbs} />

      {step.name === 'sponsor' ? (
        <SponsorLink onBack={() => setStep({ name: 'method' })} />
      ) : (
        <ArrivalWallet onNoWallet={() => setStep({ name: 'sponsor' })} />
      )}

      {isWalletConnected && step.name === 'method' && (
        <MethodSelect
          onPickCex={() => setStep({ name: 'cex-asset' })}
          onPickWallet={() => setStep({ name: 'wallet' })}
        />
      )}

      {isWalletConnected && step.name === 'wallet' && <WalletSource />}

      {isWalletConnected && step.name === 'cex-asset' && (
        <CexAssetSelect onPick={(cex, asset) => setStep({ name: 'deposit', cex, asset })} />
      )}

      {isWalletConnected && step.name === 'deposit' && (
        <DepositPanel
          cex={step.cex}
          asset={step.asset}
          onBack={() => setStep({ name: 'cex-asset' })}
        />
      )}
    </div>
  );
});

export default DepositModal;

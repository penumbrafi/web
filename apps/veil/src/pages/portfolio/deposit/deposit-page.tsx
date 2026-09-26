'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRegistry } from '@/shared/api/registry';
import { IbcChainProvider } from '@/features/cosmos/chain-provider';
import { PenumbraWaves } from '@/pages/explore/ui/waves';
import { PortfolioCard } from '@/pages/portfolio/ui/portfolio-card';
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
 * Top-level `/portfolio/deposit` page. Wraps the flow in
 * `IbcChainProvider` so the one-click shield accelerator on the final
 * step can call `useChain(...)` for the source-chain wallet — same
 * pattern as `desktop-page.tsx`.
 *
 * Renders the same page shell (waves + centered card) as the rest of
 * the portfolio so the deposit page reads as an in-place section, not
 * a modal detour.
 */
export const DepositPage = observer(() => {
  const { data: registry } = useRegistry();
  return (
    <IbcChainProvider registry={registry}>
      <PenumbraWaves />
      <div className='container mx-auto flex max-w-[720px] flex-col gap-4 py-8'>
        {/* way back out - same link the withdraw page has */}
        <div>
          <Link
            href='/portfolio'
            className='inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary focus:outline-none'
          >
            <ArrowLeft className='h-4 w-4' />
            Portfolio
          </Link>
        </div>
        <PortfolioCard title='Deposit'>
          <DepositFlow />
        </PortfolioCard>
      </div>
    </IbcChainProvider>
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
          { label: 'Someone else is sending' },
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
        <ArrivalWallet onSomeoneElse={() => setStep({ name: 'sponsor' })} />
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

export default DepositPage;

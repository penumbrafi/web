'use client';

import { observer } from 'mobx-react-lite';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useRegistry } from '@/shared/api/registry';
import { IbcChainProvider } from '@/features/cosmos/chain-provider';
import { PenumbraWaves } from '@/pages/explore/ui/waves';
import { ShieldingTicker } from '@/widgets/shielding-ticker';
import { StakingSummary } from './staking-summary';
import { StakingDialogHost } from '@/pages/portfolio/staking/ui/staking-dialog-host';
import { AssetsTable, AssetsTableLayout } from './assets-table';
import { WalletConnect } from './wallet-connect';
import { PortfolioPositionTabs } from './position-tabs';
import { AssetBars } from './asset-bars';
import { BalanceCard, DepositWithdrawButtons } from './balance-card';
import { useUnifiedAssets } from '../api/use-unified-assets';

/**
 * Heavy desktop portfolio view, isolated in its own module so the parent
 * page (`pages/portfolio/index.tsx`) can lazy-load it with `next/dynamic`.
 *
 * Why this matters: every consumer below — useUnifiedAssets, AssetBars,
 * WalletConnect — pulls in `@cosmos-kit/react`, which transitively brings
 * cosmos-kit + per-chain registry data + interchain-ui. Statically importing
 * any of them from the route-level `index.tsx` puts the whole ~1.5MB into
 * /portfolio's First Load JS. Keeping them under a single dynamic-imported
 * boundary lets webpack split the cosmos-kit subtree into its own chunk that
 * arrives after first paint of the portfolio shell.
 */
export const DesktopPortfolioPage = observer(() => {
  const { data: registry } = useRegistry();
  return (
    <IbcChainProvider registry={registry}>
      <PortfolioBody />
    </IbcChainProvider>
  );
});

const PortfolioBody = observer(() => {
  const [parent] = useAutoAnimate();
  const { isPenumbraConnected, isCosmosConnected, isConnectionLoading } = useUnifiedAssets();

  return (
    <>
      <PenumbraWaves />

      <ShieldingTicker />

      {!isConnectionLoading && (
        <div ref={parent} className='container mx-auto flex max-w-[1136px] flex-col gap-4 py-8'>
          {isPenumbraConnected ? (
            <BalanceCard />
          ) : (
            <>
              {/* The CEX-guided deposit flow lives at /portfolio/deposit; the
                  destination pages handle their own gating. */}
              <DepositWithdrawButtons />
              <WalletConnect />
            </>
          )}

          {isPenumbraConnected && <StakingSummary />}

          <AssetsTableLayout>
            {(isPenumbraConnected || isCosmosConnected) && <AssetBars />}
            <AssetsTable />
          </AssetsTableLayout>

          <PortfolioPositionTabs />
        </div>
      )}
      {isPenumbraConnected && <StakingDialogHost />}
    </>
  );
});

export default DesktopPortfolioPage;

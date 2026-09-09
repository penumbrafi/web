'use client';

import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { Coins } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
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
import { TransferTabs } from './transfer-tabs';
import { AssetBars } from './asset-bars';
import { PortfolioCard } from './portfolio-card';
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
          <WalletConnect />

          {isPenumbraConnected && (
            <>
              <StakingSummary />
              <div className='flex justify-end'>
                {/* Staking choice now lives in explore, where all the validator
                    data is — /portfolio just shows the position and lets the
                    user act on it in place via <StakingDialogHost>. */}
                <Link href='/explore/validators'>
                  <Button actionType='accent' priority='secondary' icon={Coins} density='compact'>
                    Find validators to stake
                  </Button>
                </Link>
              </div>
            </>
          )}

          {/* Asset Allocation Bars */}
          {(isPenumbraConnected || isCosmosConnected) && (
            <PortfolioCard title={'Allocation'}>
              <AssetBars />
            </PortfolioCard>
          )}

          <AssetsTableLayout>
            <AssetsTable />
          </AssetsTableLayout>

          {isPenumbraConnected && <TransferTabs />}

          <PortfolioPositionTabs />
        </div>
      )}
      {isPenumbraConnected && <StakingDialogHost />}
    </>
  );
});

export default DesktopPortfolioPage;

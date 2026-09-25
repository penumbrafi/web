import { TableCell } from '@penumbra-zone/ui/TableCell';
import { Text } from '@penumbra-zone/ui/Text';

import { Density } from '@penumbra-zone/ui/Density';
import { Skeleton } from '@/shared/ui/skeleton';

import { observer } from 'mobx-react-lite';
import { useUnifiedAssets } from '../api/use-unified-assets.ts';
import { useAssetPrices } from '../api/use-asset-prices.ts';
import { AssetRow } from '@/pages/portfolio/ui/asset-row.tsx';
import { DelegationRows } from '@/pages/portfolio/ui/delegation-rows.tsx';
import { PortfolioCard } from '@/pages/portfolio/ui/portfolio-card.tsx';
import { ReactNode } from 'react';
import { ReceiveButton } from '@/pages/portfolio/ui/asset-actions.tsx';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { CosmosConnectButton } from '@/features/cosmos/cosmos-connect-button.tsx';

export const AssetsTableLayout = ({ children }: { children?: ReactNode }) => {
  return (
    <PortfolioCard
      title={
        <div className='flex items-center justify-between'>
          <Text as={'h4'} xxl color='text.primary'>
            Assets
          </Text>
          <div className='flex items-center gap-2'>
            {/* Public balances need a Cosmos wallet; this was one of the two
                big connect cards at the top of the page. */}
            <CosmosConnectButton variant='minimal' actionType='default' />
            {/* Choosing a validator lives in explore, next to the validator data. */}
            <Link href='/explore/validators'>
              <Button density='compact' priority='secondary' icon={Coins}>
                Stake
              </Button>
            </Link>
            <ReceiveButton />
          </div>
        </div>
      }
    >
      {children}
    </PortfolioCard>
  );
};

const LoadingRow = () => {
  return (
    <div className='col-span-7 grid grid-cols-subgrid'>
      <TableCell loading>
        <div className='flex items-center gap-2'>
          <div className='h-6 w-6 overflow-hidden rounded-full'>
            <Skeleton />
          </div>
          <div className='h-5 w-20'>
            <Skeleton />
          </div>
        </div>
      </TableCell>
      <TableCell loading>
        <div className='h-5 w-24'>
          <Skeleton />
        </div>
      </TableCell>
      <TableCell loading>
        <div className='h-5 w-24'>
          <Skeleton />
        </div>
      </TableCell>
      <TableCell loading>
        <div className='h-5 w-24'>
          <Skeleton />
        </div>
      </TableCell>
      <TableCell loading>
        <div className='h-5 w-24'>
          <Skeleton />
        </div>
      </TableCell>
      <TableCell loading>
        <div className='h-5 w-24'>
          <Skeleton />
        </div>
      </TableCell>
    </div>
  );
};

const LoadingState = () => {
  return (
    <Density compact>
      <div className='grid grid-cols-[1fr_1fr_1fr_1fr_auto_auto_auto] overflow-x-auto overflow-y-auto'>
        <TableCell heading>Shielded Balance</TableCell>
        <TableCell heading>Public Balance</TableCell>
        <TableCell heading>Price</TableCell>
        <TableCell heading>Shielded Value</TableCell>
        <TableCell heading>Public Value</TableCell>
        <TableCell heading>Total Value</TableCell>
        <TableCell heading>&nbsp;</TableCell>
      </div>

      {Array.from({ length: 6 }).map((_, i) => (
        <LoadingRow key={i} />
      ))}
    </Density>
  );
};

const NotConnectedNotice = () => {
  return (
    <div className='flex h-[400px] flex-col items-center justify-center gap-4'>
      <Text color='text.secondary' small>
        Connect wallet to see your assets
      </Text>
    </div>
  );
};

const NoAssetsNotice = () => {
  return (
    <div className='flex h-[400px] flex-col items-center justify-center gap-4'>
      <Text color='text.secondary' small>
        No assets found in your connected wallets
      </Text>
    </div>
  );
};

export const AssetsTable = observer(() => {
  const { unifiedAssets, isLoading, isPenumbraConnected, isCosmosConnected } = useUnifiedAssets();
  const { prices } = useAssetPrices(unifiedAssets.map(asset => asset.metadata));

  if (isLoading) {
    return <LoadingState />;
  }

  if (!isPenumbraConnected && !isCosmosConnected) {
    return <NotConnectedNotice />;
  }

  if (unifiedAssets.length === 0) {
    return <NoAssetsNotice />;
  }

  const umPriceRow = prices['UM'];

  return (
    <Density compact>
      <div className='grid grid-cols-[1fr_1fr_1fr_1fr_auto_auto_auto] overflow-x-auto overflow-y-auto'>
        <TableCell heading>Shielded Balance</TableCell>
        <TableCell heading>Public Balance</TableCell>
        <TableCell heading>Price</TableCell>
        <TableCell heading>Shielded Value</TableCell>
        <TableCell heading>Public Value</TableCell>
        <TableCell heading>Total Value</TableCell>
        <TableCell heading>&nbsp;</TableCell>

        {unifiedAssets.map((asset, index) => (
          <AssetRow
            key={asset.symbol}
            asset={asset}
            price={{
              price: prices[asset.symbol]?.price ?? 0,
              quoteSymbol: prices[asset.symbol]?.quoteSymbol ?? '-',
            }}
            isCosmosConnected={isCosmosConnected}
            isLastRow={index === unifiedAssets.length - 1}
          />
        ))}

        {/* Per-validator stake rows. The grid spans col-span-7 so the
            sub-rows line up with the asset header columns. */}
        <DelegationRows umPrice={umPriceRow?.price} umQuoteSymbol={umPriceRow?.quoteSymbol} />
      </div>
    </Density>
  );
});

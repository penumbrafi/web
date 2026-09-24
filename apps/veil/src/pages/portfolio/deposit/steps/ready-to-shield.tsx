'use client';

import { useMemo, useState } from 'react';
import { Zap, ChevronRight } from 'lucide-react';
import { useChain } from '@cosmos-kit/react';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { Metadata, ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { getFormattedAmtFromValueView } from '@penumbra-zone/types/value-view';
import { useBalances as useCosmosBalances } from '@/features/cosmos/use-augmented-balances';
import type { UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets';
import { NativeShieldDialog } from '@/pages/portfolio/ui/native-shield-dialog';

/**
 * Surfaces assets the user ALREADY holds in a connected Cosmos wallet as
 * a shield-now fast path, above the CEX flow. A user who already moved
 * funds from Kraken to Keplr yesterday should not have to walk through
 * the "Which exchange are you withdrawing from?" picker to shield today.
 *
 * Renders nothing when the wallet is disconnected or there is no
 * positive balance on a chain Penumbra bridges to. That way it never
 * adds visual noise for a first-time visitor who genuinely does need
 * the CEX flow.
 */
export const ReadyToShield = () => {
  const { balances } = useCosmosBalances();
  const ready = useReadyAssets(balances);
  const [openAsset, setOpenAsset] = useState<UnifiedAsset | null>(null);

  if (ready.length === 0) return null;

  return (
    <div className='flex flex-col gap-3 rounded-xl border border-primary-main/40 bg-primary-main/5 p-4'>
      <div className='flex items-center gap-2'>
        <Zap className='h-4 w-4 text-primary-main' />
        <Text variant='strong' color='text.primary'>
          Ready to shield
        </Text>
      </div>
      <Text small color='text.secondary'>
        You already have these in a connected wallet. Skip the exchange step - shield in one click.
      </Text>
      <ReadyList ready={ready} onPick={setOpenAsset} />
      {openAsset && (
        <NativeShieldDialog
          asset={openAsset}
          isOpen={!!openAsset}
          onClose={() => setOpenAsset(null)}
        />
      )}
    </div>
  );
};

/**
 * "From a wallet" deposit step. Unlike the hint above, this one must say
 * something in every state: not connected, connecting, couldn't reach the
 * chain, connected but empty, or the balances to move.
 */
export const WalletSource = () => {
  const chain = useChain('injective');
  const { balances, isLoading, error, refetch } = useCosmosBalances();
  const ready = useReadyAssets(balances);
  const [openAsset, setOpenAsset] = useState<UnifiedAsset | null>(null);

  let body: React.ReactNode;
  if (!chain.isWalletConnected) {
    body = (
      <div className='flex flex-col gap-3'>
        <Text small color='text.secondary'>
          Connect the Injective wallet that holds your funds.
        </Text>
        <div>
          <Button
            actionType='accent'
            density='compact'
            onClick={() => void chain.connect()}
            disabled={chain.isWalletConnecting}
          >
            {chain.isWalletConnecting ? 'Connecting...' : 'Connect Keplr or Leap'}
          </Button>
        </div>
      </div>
    );
  } else if (ready.length > 0) {
    body = <ReadyList ready={ready} onPick={setOpenAsset} />;
  } else if (isLoading) {
    body = (
      <Text small color='text.secondary'>
        Checking balances...
      </Text>
    );
  } else if (error) {
    body = (
      <div className='flex flex-col gap-3'>
        <Text small color='text.secondary'>
          Couldn&apos;t reach Injective to read your balances. This is a network problem, not an
          empty wallet.
        </Text>
        <div>
          <Button density='compact' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <Text small color='text.secondary'>
        Nothing Penumbra accepts is in this wallet yet. Send USDC or INJ on the Injective network to
        it, then come back.
      </Text>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <Text variant='strong' color='text.primary'>
          Move funds from your Injective wallet
        </Text>
        {chain.address && (
          <Text detailTechnical color='text.secondary'>
            {chain.address}
          </Text>
        )}
      </div>
      {body}
      {openAsset && (
        <NativeShieldDialog
          asset={openAsset}
          isOpen={!!openAsset}
          onClose={() => setOpenAsset(null)}
        />
      )}
    </div>
  );
};

const useReadyAssets = (
  balances: ReturnType<typeof useCosmosBalances>['balances'],
): UnifiedAsset[] =>
  useMemo(() => {
    return balances
      .filter(b => Number(b.amount) > 0)
      .map(({ asset, amount, chainId }): UnifiedAsset => {
        // Mirror the ValueView construction use-unified-assets.ts does
        // so downstream (NativeShieldDialog + useIbcShield) sees the
        // same shape as an asset row on /portfolio.
        const metadata = new Metadata({
          base: asset.base,
          display: asset.display,
          denomUnits: asset.denom_units,
          symbol: asset.symbol,
          penumbraAssetId: { inner: new Uint8Array([1]) },
          coingeckoId: asset.coingecko_id,
          images: asset.images,
          name: asset.name,
          description: asset.description,
        });
        const valueView = new ValueView({
          valueView: {
            case: 'knownAssetId',
            value: {
              amount: pnum(amount).toAmount(),
              metadata,
              equivalentValues: [],
            },
          },
        });
        return {
          symbol: asset.symbol,
          metadata,
          shieldedBalances: [],
          publicBalances: [{ chainId, denom: asset.base, valueView }],
        };
      });
  }, [balances]);

const ReadyList = ({
  ready,
  onPick,
}: {
  ready: UnifiedAsset[];
  onPick: (asset: UnifiedAsset) => void;
}) => (
  <ul className='flex flex-col gap-1'>
    {ready.map(asset => {
      const bal = asset.publicBalances[0];
      if (!bal) return null;
      const chainId = bal.chainId;
      const amountStr = getFormattedAmtFromValueView(bal.valueView);
      return (
        <li key={`${asset.symbol}-${chainId}-${bal.denom}`}>
          <button
            type='button'
            onClick={() => onPick(asset)}
            className='group flex w-full items-center justify-between rounded-lg bg-other-tonal-fill5 px-3 py-3 text-left transition-colors hover:bg-other-tonal-fill10'
          >
            <div className='flex flex-col gap-0.5'>
              <Text variant='strong' color='text.primary'>
                {amountStr} {asset.symbol}
              </Text>
              <Text detail color='text.secondary'>
                on {chainId}
              </Text>
            </div>
            <ChevronRight className='h-4 w-4 text-text-secondary transition-transform group-hover:translate-x-0.5' />
          </button>
        </li>
      );
    })}
  </ul>
);

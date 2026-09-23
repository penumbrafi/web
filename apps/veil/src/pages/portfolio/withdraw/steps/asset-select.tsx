'use client';

import Image from 'next/image';
import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { getMetadata } from '@penumbra-zone/getters/value-view';

import { useRegistry } from '@/shared/api/registry.tsx';
import { useUnifiedAssets, type UnifiedAsset, type ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets';

interface AssetSelectStepProps {
  onSelect: (asset: UnifiedAsset, balance: ShieldedBalance) => void;
}

/**
 * First step: user picks which shielded asset to withdraw.
 *
 * "Withdrawable" means:
 *   1. the asset has a non-zero shielded balance, AND
 *   2. its metadata carries an IBC channel (`base` starts with
 *      `transfer/channel-N/...`) that we can look up in the registry.
 *
 * Assets that are shielded but not sourced from an IBC connection (e.g.
 * native UM) are omitted — you can't unshield UM to a Cosmos chain.
 */
export const AssetSelectStep = observer(({ onSelect }: AssetSelectStepProps) => {
  const { data: registry } = useRegistry();
  const { unifiedAssets, isPenumbraConnected } = useUnifiedAssets();

  if (!isPenumbraConnected) {
    return (
      <div className='flex flex-col items-center gap-3 py-16 text-center'>
        <Text variant='large' color='text.primary'>
          Connect Prax to withdraw
        </Text>
        <Text variant='small' color='text.secondary'>
          Withdrawals move shielded balances back out to an exchange or wallet on the source chain.
        </Text>
      </div>
    );
  }

  const rows = unifiedAssets
    .flatMap(asset =>
      asset.shieldedBalances
        .filter(b => {
          const meta = getMetadata.optional(b.valueView);
          if (!meta) return false;
          if (!meta.base.startsWith('transfer/')) return false;
          // Non-zero amount.
          const view = b.valueView.valueView;
          if (view.case !== 'knownAssetId') return false;
          const amt = view.value.amount;
          if (!amt) return false;
          return amt.lo !== 0n || amt.hi !== 0n;
        })
        .map(balance => ({ asset, balance })),
    );

  if (rows.length === 0) {
    return (
      <div className='flex flex-col items-center gap-3 py-16 text-center'>
        <Text variant='large' color='text.primary'>
          Nothing to withdraw yet
        </Text>
        <Text variant='small' color='text.secondary'>
          Shield some funds first, then come back here to send them out.
        </Text>
        <Link href='/portfolio/deposit'>
          <Button priority='primary'>Deposit</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <Text variant='body' color='text.primary'>
        Select an asset
      </Text>
      <Text variant='detail' color='text.secondary'>
        Only shielded balances with an IBC source chain can be withdrawn.
        The destination network is fixed by the asset&apos;s origin.
      </Text>

      <ul className='flex flex-col gap-2'>
        {rows.map(({ asset, balance }) => {
          const meta = getMetadata.optional(balance.valueView);
          const channelId = meta?.base.split('/')[1] ?? '';
          const chain = registry.ibcConnections.find(c => c.channelId === channelId);
          return (
            <li key={`${asset.symbol}-${channelId}`}>
              <button
                type='button'
                onClick={() => onSelect(asset, balance)}
                className='flex w-full items-center justify-between gap-3 rounded-lg border border-other-tonal-stroke bg-other-tonal-fill5 p-3 text-left transition-colors hover:bg-other-tonal-fill10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-main'
              >
                <div className='min-w-0 flex-1'>
                  <ValueViewComponent
                    valueView={balance.valueView}
                    context='table'
                    priority='primary'
                  />
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  {chain?.images[0]?.png && (
                    <Image
                      width={20}
                      height={20}
                      src={chain.images[0].png}
                      alt={chain.displayName}
                    />
                  )}
                  <Text variant='detail' color='text.secondary'>
                    to {chain?.displayName ?? 'Unknown'}
                  </Text>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

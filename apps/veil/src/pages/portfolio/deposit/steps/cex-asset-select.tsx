'use client';

import { useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { CEX_CONFIG, type CexAsset, type CexConfig } from '@/features/deposit/cex-config';

interface CexAssetSelectProps {
  onPick: (cex: CexConfig, asset: CexAsset) => void;
}

/**
 * Two-panel picker: exchange list on the left, that exchange's supported
 * asset+network combos on the right. Below tablet width the two panels
 * stack.
 *
 * Every asset row calls out its network prominently — a user withdrawing
 * over the wrong network is the single most common way to lose funds on
 * a CEX withdrawal, so the network reads at the same weight as the
 * symbol.
 */
export const CexAssetSelect = ({ onPick }: CexAssetSelectProps) => {
  const [activeCexId, setActiveCexId] = useState<string>(CEX_CONFIG[0]?.id ?? '');
  const activeCex = CEX_CONFIG.find(c => c.id === activeCexId) ?? CEX_CONFIG[0];

  if (!activeCex) {return null;}

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <Text variant='strong' color='text.primary'>
          Which exchange are you withdrawing from?
        </Text>
        <Text small color='text.secondary'>
          Pick your exchange, then the asset and network you'll withdraw over.
        </Text>
      </div>

      <div className='grid grid-cols-1 gap-3 tablet:grid-cols-[12rem_1fr]'>
        <ul className='flex max-h-96 flex-col gap-1 overflow-auto rounded-xl bg-other-tonal-fill5 p-2'>
          {CEX_CONFIG.map(cex => {
            const isActive = cex.id === activeCex.id;
            return (
              <li key={cex.id}>
                <button
                  type='button'
                  onClick={() => setActiveCexId(cex.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'bg-other-tonal-fill10 text-text-primary'
                      : 'text-text-secondary hover:bg-other-tonal-fill10 hover:text-text-primary'
                  }`}
                >
                  <CexAvatar cex={cex} />
                  <Text small color={isActive ? 'text.primary' : 'text.secondary'}>
                    {cex.name}
                  </Text>
                </button>
              </li>
            );
          })}
        </ul>

        <ul className='flex max-h-96 flex-col gap-1 overflow-auto rounded-xl bg-other-tonal-fill5 p-2'>
          {activeCex.assets.map(asset => (
            <li key={`${asset.symbol}-${asset.chainId}-${asset.sourceDenom}`}>
              <button
                type='button'
                onClick={() => onPick(activeCex, asset)}
                className='flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-other-tonal-fill10'
              >
                <div className='flex flex-col gap-0.5'>
                  <Text variant='strong' color='text.primary'>
                    {asset.symbol}
                  </Text>
                  <Text detail color='text.secondary'>
                    on {asset.network} network
                  </Text>
                </div>
                <div className='flex flex-col items-end gap-0.5'>
                  <Text detail color='text.secondary'>
                    Min. {asset.minDeposit} {asset.symbol}
                  </Text>
                  <Text detail color='text.secondary'>
                    ~{asset.estimatedArrival}
                  </Text>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/**
 * Colored text-avatar fallback: brand color as background + first letter,
 * so users recognize their exchange at a glance without us shipping any
 * trademarked SVGs. Falls back to a neutral tile if brandColor is unset.
 */
const CexAvatar = ({ cex }: { cex: CexConfig }) => {
  const bg = cex.brandColor;
  const fg = cex.brandColorContrast === 'dark' ? '#111' : '#fff';
  return (
    <div
      className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold'
      style={
        bg
          ? { backgroundColor: bg, color: fg }
          : undefined
      }
    >
      <span className={bg ? '' : 'text-text-primary'}>{cex.name.slice(0, 1)}</span>
    </div>
  );
};

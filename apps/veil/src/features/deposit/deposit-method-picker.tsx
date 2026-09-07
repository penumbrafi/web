'use client';

import { Text } from '@penumbra-zone/ui/Text';
import { ArrowLeft, Wallet, ChevronRight, ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DepositRoute {
  srcChainId: string;
  srcAssetDenom: string;
  /** Chip label shown to the user in the picker. */
  label: string;
  /** One-line hint shown under the label. */
  hint?: string;
}

/** Per-source presets. Skip's defaultRoute only takes srcChain + srcAsset; the
 *  user can still tweak everything inside the widget. Exchange on-ramps are
 *  handled by the wallet (Zafu), not here. */
const ONCHAIN: DepositRoute[] = [
  {
    label: 'Cosmos Hub',
    hint: 'Bring ATOM via IBC',
    srcChainId: 'cosmoshub-4',
    srcAssetDenom: 'uatom',
  },
  {
    label: 'Osmosis',
    hint: 'Any IBC asset on Osmosis',
    srcChainId: 'osmosis-1',
    srcAssetDenom: 'uosmo',
  },
  {
    label: 'Noble',
    hint: 'Native USDC, no extra hop',
    srcChainId: 'noble-1',
    srcAssetDenom: 'uusdc',
  },
  {
    label: 'Ethereum',
    hint: 'USDC via Noble bridge',
    srcChainId: '1',
    srcAssetDenom: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  },
  {
    label: 'Solana',
    hint: 'USDC via Noble',
    srcChainId: 'solana',
    srcAssetDenom: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
];

interface PickerProps {
  /** Called when the user picks a route — the dialog should swap to the Skip widget. */
  onPick: (route: DepositRoute) => void;
}

/**
 * Top-level "where are your funds?" picker: pick the chain that already
 * holds your funds and Skip opens on that source.
 *
 * Inside Skip, the user can change the asset, source chain, and amount —
 * the picker just sets the most likely starting point.
 */
export const DepositMethodPicker = ({ onPick }: PickerProps) => (
  <div className='flex flex-col gap-6'>
    <div className='flex flex-col gap-2'>
      <Text variant='strong' color='text.primary'>
        Where are your funds?
      </Text>
      <Text small color='text.secondary'>
        Pick the source — we&apos;ll route the rest. All paths arrive as a shielded
        balance on Penumbra; nothing reveals your wallet to the source chain.
      </Text>
    </div>

    <Group label='From another chain' icon={Wallet} routes={ONCHAIN} onPick={onPick} />

    <div className='flex items-center justify-between border-t border-t-other-tonal-stroke pt-4'>
      <Text detail color='text.secondary'>
        Want a different bridge UI?
      </Text>
      <a
        href='https://widget-nextjs.vercel.app/'
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-1 text-text-primary underline-offset-2 hover:underline'
      >
        <Text small>Open multi-chain tool</Text>
        <ExternalLink className='h-3 w-3' />
      </a>
    </div>
  </div>
);

const Group = ({
  label,
  icon: Icon,
  routes,
  onPick,
}: {
  label: string;
  icon: LucideIcon;
  routes: DepositRoute[];
  onPick: (r: DepositRoute) => void;
}) => (
  <div className='flex flex-col gap-2'>
    <div className='flex items-center gap-2'>
      <Icon className='h-4 w-4 text-text-secondary' />
      <Text detail color='text.secondary'>
        {label}
      </Text>
    </div>
    <div className='grid grid-cols-1 gap-2 tablet:grid-cols-2'>
      {routes.map(route => (
        <button
          key={route.label}
          type='button'
          onClick={() => onPick(route)}
          className='group flex items-center justify-between gap-3 rounded-lg bg-other-tonal-fill5 p-3 text-left transition-colors hover:bg-other-tonal-fill10'
        >
          <div className='flex flex-col gap-0.5'>
            <Text variant='strong' color='text.primary'>
              {route.label}
            </Text>
            {route.hint && (
              <Text detail color='text.secondary'>
                {route.hint}
              </Text>
            )}
          </div>
          <ChevronRight className='h-4 w-4 text-text-secondary transition-transform group-hover:translate-x-0.5' />
        </button>
      ))}
    </div>
  </div>
);

interface BackButtonProps {
  onBack: () => void;
}

/** Small "back to picker" link rendered above the Skip widget after a route is chosen. */
export const DepositBackToPicker = ({ onBack }: BackButtonProps) => (
  <button
    type='button'
    onClick={onBack}
    className='flex items-center gap-1 text-text-secondary hover:text-text-primary'
  >
    <ArrowLeft className='h-3.5 w-3.5' />
    <Text small>Choose a different source</Text>
  </button>
);

'use client';

import { Text } from '@penumbra-zone/ui/Text';
import { ArrowLeft, Building2, Wallet, ChevronRight, ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** A source the Skip widget can route to Penumbra on its own. */
export interface SkipDepositRoute {
  kind: 'skip';
  srcChainId: string;
  srcAssetDenom: string;
  /** Chip label shown to the user in the picker. */
  label: string;
  /** One-line hint shown under the label. */
  hint?: string;
}

/**
 * A source Skip cannot route yet, deposited with a plain ICS-20 transfer
 * from the user's own wallet against our ephemeral Penumbra address.
 */
export interface ManualDepositRoute {
  kind: 'manual';
  srcChainId: string;
  /** Channel on the SOURCE chain that points at penumbra-1. */
  srcChannelId: string;
  /** Assets Penumbra accepts over this channel, for the panel copy. */
  assetsHint: string;
  label: string;
  hint?: string;
}

export type DepositRoute = SkipDepositRoute | ManualDepositRoute;

/** Per-source presets. Skip's defaultRoute only takes srcChain + srcAsset; the
 *  user can still tweak everything inside the widget. Exchange on-ramps are
 *  handled by the wallet (Zafu), not here.
 *
 *  Injective is first: it is the newest and shortest path in, and the one
 *  reachable straight from an exchange withdrawal. Skip has no Penumbra
 *  destination denom for Injective-sourced assets yet, so it uses the manual
 *  ICS-20 panel instead of the widget. */
// Sources for the multi-chain "From another wallet" flow. Noble is
// intentionally OMITTED — Circle is winding down Noble USDC and we no
// longer route new value through it (see cex-config.ts). Ethereum /
// Solana are also omitted from the direct picker: Skip's Penumbra
// destination graph today can't finish those routes without a Noble
// hop, so surfacing them would send users to a widget that
// dead-ends. Injective is the direct IBC path we control; Cosmos Hub
// and Osmosis remain for users who want to swap into an
// Injective-sourced denom via Skip and land on Penumbra as USDC.inj.
const ONCHAIN: DepositRoute[] = [
  {
    kind: 'manual',
    label: 'Injective',
    hint: 'USDC, INJ and more — direct IBC',
    srcChainId: 'injective-1',
    srcChannelId: 'channel-494',
    assetsHint: 'USDC, AUSD, USDT and INJ',
  },
  {
    kind: 'skip',
    label: 'Osmosis',
    hint: 'Swap any Osmosis asset to a Penumbra-supported denom',
    srcChainId: 'osmosis-1',
    srcAssetDenom: 'uosmo',
  },
  {
    kind: 'skip',
    label: 'Cosmos Hub',
    hint: 'Swap ATOM via Osmosis then bridge to Penumbra',
    srcChainId: 'cosmoshub-4',
    srcAssetDenom: 'uatom',
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

    <div className='flex flex-col gap-2 border-t border-t-other-tonal-stroke pt-4'>
      <div className='flex items-center gap-2'>
        <Building2 className='h-4 w-4 text-text-secondary' />
        <Text detail color='text.secondary'>
          Exchange gateways
        </Text>
      </div>
      <Text small color='text.secondary'>
        Withdraw INJ from Kraken or Binance, or USDC from Kraken, straight to the Injective
        network — to your inj1… address in Zafu or any Injective wallet. Then pick Injective
        above to shield it.
      </Text>
    </div>

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

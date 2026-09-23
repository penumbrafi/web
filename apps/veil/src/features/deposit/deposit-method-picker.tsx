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
// Sources for the multi-chain "From another wallet" flow.
//
// Every non-Injective route today either goes through Noble (being
// wound down by Circle, contract fully paused 2027-01-12; see
// research note in cex-config.ts) or hits an expired IBC channel:
//   - Direct Osmosis↔Penumbra light client is expired.
//   - Skip routes Osmosis USDC → Penumbra only via the Noble PFM hop.
//   - Ethereum/Solana CCTP paths terminate at Noble too.
//   - INJ / USDC.inj on Osmosis exist but pool depth is thin ($45k
//     INJ, $216k USDC.inj) — bad for real-size deposits.
//
// Rather than surface options that either dead-end or funnel new
// value into a sunsetting bridge, this flow shows only Injective
// (direct IBC via our own channel). Everything else lives in the
// CEX-guided flow, which naturally routes users through Injective.
// Reopen this list once we add a live non-Noble multi-hop path.
const ONCHAIN: DepositRoute[] = [
  {
    kind: 'manual',
    label: 'Injective',
    hint: 'USDC, INJ and more — direct IBC',
    srcChainId: 'injective-1',
    srcChannelId: 'channel-494',
    assetsHint: 'USDC, AUSD, USDT and INJ',
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

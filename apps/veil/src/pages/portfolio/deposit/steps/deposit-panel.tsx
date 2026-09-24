'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import BigNumber from 'bignumber.js';
import { AlertTriangle, ArrowLeft, Check, Copy, Shield } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useChain } from '@cosmos-kit/react';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { pnum } from '@penumbra-zone/types/pnum';

import type { CexAsset, CexConfig } from '@/features/deposit/cex-config';
import { useIbcShield } from '@/features/deposit/use-ibc-shield';
import { useZafuHandoff } from '@/features/deposit/use-zafu-handoff';
import { PrivateTxHash } from '@/shared/ui/private-tx-hash';
import { SUPPORTED_CHAINS } from '@/features/cosmos/supported-chains';
import { useUnifiedAssets, type UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets';

interface DepositPanelProps {
  cex: CexConfig;
  asset: CexAsset;
  onBack: () => void;
}

/**
 * The payoff step. Exchanges cannot withdraw to a Penumbra address: every
 * route here lands on a public chain (Injective), and the exchange's
 * withdrawal form only accepts that chain's addresses (inj1...). So the flow
 * is two hops:
 *
 *   1. exchange -> the user's own address on that chain (shown here, from the
 *      connected Keplr/Leap wallet), then
 *   2. that address -> Penumbra in one signature (the shield section below,
 *      which appears once the balance lands).
 *
 * A Penumbra address must never be shown as the exchange destination: the
 * exchange rejects it at best, and it teaches users to paste shielded
 * addresses into CEX forms.
 */
export const DepositPanel = observer(({ cex, asset, onBack }: DepositPanelProps) => {
  const queryClient = useQueryClient();

  const chainName = useMemo(
    () => SUPPORTED_CHAINS.find(c => c.chain_id === asset.chainId)?.chain_name ?? null,
    [asset.chainId],
  );
  // useChain needs a registered chain name; the placeholder is never read
  // when chainName is unresolved (sourceAddress stays undefined).
  const chain = useChain(chainName ?? SUPPORTED_CHAINS[0]?.chain_name ?? 'injective');
  const sourceAddress = chainName && chain.isWalletConnected ? chain.address : undefined;
  const chainLabel = chainName ? (chain.chain.pretty_name ?? asset.network) : asset.network;
  const zafu = useZafuHandoff();

  // Ephemeral addresses are single-use. `useDepositAddress` caches for
  // 60s under a fixed key, so a remount within that window would reuse
  // the same address. On unmount, purge the cached entry so re-entering
  // the flow rotates to a fresh one.
  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['deposit-address'] });
    };
  }, [queryClient]);

  return (
    <div className='flex flex-col gap-4'>
      <button
        type='button'
        onClick={onBack}
        className='flex w-fit items-center gap-1 text-text-secondary hover:text-text-primary'
      >
        <ArrowLeft className='h-3.5 w-3.5' />
        <Text small>Change selection</Text>
      </button>

      <div className='flex flex-col gap-1'>
        <Text variant='strong' color='text.primary'>
          {asset.journey
            ? `${asset.symbol} from ${cex.name} → Penumbra`
            : `Withdraw ${asset.symbol} from ${cex.name} via ${asset.network}`}
        </Text>
        <Text small color='text.secondary'>
          {asset.journey
            ? `${cex.name} doesn't drop ${asset.symbol} on Injective directly — follow the steps below to route it here.`
            : `Withdraw to your ${chainLabel} address below, then shield it into Penumbra in one signature.`}
        </Text>
      </div>

      {asset.journey ? (
        <JourneySteps steps={asset.journey} />
      ) : (
        <NetworkWarning network={asset.network} symbol={asset.symbol} />
      )}

      <SourceAddressPanel
        chainLabel={chainLabel}
        cexName={cex.name}
        address={sourceAddress}
        canConnect={Boolean(chainName)}
        onConnect={() => {
          void chain.connect();
        }}
        zafu={zafu.isZafu && asset.chainId === 'injective-1' ? zafu : undefined}
      />

      <div className='grid grid-cols-2 gap-3 rounded-xl bg-other-tonal-fill5 p-4'>
        <MetaLine label='Network' value={asset.network} />
        <MetaLine label='Asset' value={asset.symbol} />
        <MetaLine label='Minimum deposit' value={`${asset.minDeposit} ${asset.symbol}`} />
        <MetaLine label='Estimated arrival' value={`~${asset.estimatedArrival}`} />
      </div>

      <OneClickShieldSection cexAsset={asset} />
    </div>
  );
});
DepositPanel.displayName = 'DepositPanel';

const MetaLine = ({ label, value }: { label: string; value: string }) => (
  <div className='flex flex-col gap-0.5'>
    <Text detail color='text.secondary'>
      {label}
    </Text>
    <Text small color='text.primary'>
      {value}
    </Text>
  </div>
);

const JourneySteps = ({ steps }: { steps: NonNullable<CexAsset['journey']> }) => (
  <ol className='flex flex-col gap-2 rounded-xl bg-other-tonal-fill5 p-4'>
    {steps.map((step, i) => (
      <li key={i} className='flex items-start gap-3'>
        <span className='mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-main/20 text-xs font-semibold text-primary-main'>
          {i + 1}
        </span>
        <div className='flex flex-col gap-1'>
          <Text small color='text.primary'>
            {step.title}
          </Text>
          <Text detail color='text.secondary'>
            {step.hint}
            {step.link && (
              <>
                {' '}
                <a
                  href={step.link.url}
                  target='_blank'
                  rel='noreferrer'
                  className='text-primary-main hover:underline'
                >
                  {step.link.label} ↗
                </a>
              </>
            )}
          </Text>
        </div>
      </li>
    ))}
  </ol>
);

const NetworkWarning = ({ network, symbol }: { network: string; symbol: string }) => (
  <div className='flex items-start gap-3 rounded-xl border border-destructive-light/40 bg-destructive-light/10 p-3'>
    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-destructive-light' />
    <div className='flex flex-col gap-1'>
      <Text small color='destructive.light'>
        Only send {symbol} on the {network} network.
      </Text>
      <Text detail color='text.secondary'>
        Wrong network = permanent loss. Double-check {network} is selected before you confirm the
        withdrawal.
      </Text>
    </div>
  </div>
);

/**
 * The exchange's withdrawal destination: the user's own address on the
 * source chain, from the connected Keplr/Leap wallet. Without a connected
 * wallet we ask them to connect rather than falling back to anything else.
 * When the Penumbra wallet is Zafu, the primary action hands off to Zafu's own
 * shield screen instead (it shows its Injective address and shields for them).
 */
const SourceAddressPanel = ({
  chainLabel,
  cexName,
  address,
  canConnect,
  onConnect,
  zafu,
}: {
  chainLabel: string;
  cexName: string;
  address?: string;
  canConnect: boolean;
  onConnect: () => void;
  zafu?: { openShield: () => Promise<void>; isOpening: boolean; error?: string };
}) => {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!address && zafu) {
    return (
      <div className='flex flex-col items-start gap-3 rounded-xl border border-primary-main/40 bg-primary-main/5 p-4'>
        <div className='flex flex-col gap-1'>
          <Text variant='strong' color='text.primary'>
            Shield with Zafu
          </Text>
          <Text small color='text.secondary'>
            {cexName} withdraws to your own {chainLabel} address. Zafu shows yours, then shields
            it into Penumbra.
          </Text>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            actionType='accent'
            priority='primary'
            disabled={zafu.isOpening}
            onClick={() => {
              void zafu.openShield();
            }}
          >
            {zafu.isOpening ? 'Opening Zafu...' : 'Open in Zafu'}
          </Button>
          <Button actionType='default' priority='secondary' disabled={!canConnect} onClick={onConnect}>
            Use Keplr or Leap
          </Button>
        </div>
        {zafu.error && (
          <Text detail color='destructive.light'>
            {zafu.error}
          </Text>
        )}
      </div>
    );
  }

  if (!address) {
    return (
      <div className='flex flex-col items-start gap-3 rounded-xl border border-primary-main/40 bg-primary-main/5 p-4'>
        <div className='flex flex-col gap-1'>
          <Text variant='strong' color='text.primary'>
            Connect a {chainLabel} wallet
          </Text>
          <Text small color='text.secondary'>
            {cexName} withdraws to your own {chainLabel} address. Connect Keplr or Leap and it
            appears here.
          </Text>
        </div>
        <Button actionType='accent' priority='primary' disabled={!canConnect} onClick={onConnect}>
          Connect {chainLabel} wallet
        </Button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2 rounded-xl bg-other-tonal-fill5 p-4'>
      <Text detail color='text.secondary'>
        Your {chainLabel} address - paste into {cexName}&apos;s withdrawal form
      </Text>
      <div className='flex items-start gap-3'>
        <span className='min-w-0 flex-1 font-mono text-xs break-all text-text-primary'>
          {address}
        </span>
        <button
          type='button'
          onClick={onCopy}
          aria-label='Copy destination address'
          className='shrink-0 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:bg-other-tonal-fill10 hover:text-text-primary'
        >
          {copied ? (
            <span className='flex items-center gap-1'>
              <Check className='h-4 w-4' />
              <Text detail>Copied</Text>
            </span>
          ) : (
            <span className='flex items-center gap-1'>
              <Copy className='h-4 w-4' />
              <Text detail>Copy</Text>
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * Renders the one-click shield accelerator when — and only when — the
 * user has a matching non-zero balance on the source chain in a
 * connected Cosmos wallet. We look it up by (chainId, sourceDenom) to
 * avoid confusing e.g. USDC-on-Injective with USDC-on-Noble which
 * `useUnifiedAssets` merges under one symbol.
 */
const OneClickShieldSection = ({ cexAsset }: { cexAsset: CexAsset }) => {
  const { unifiedAssets, isCosmosConnected } = useUnifiedAssets();

  const narrowed = useMemo(() => {
    if (!isCosmosConnected) return null;
    for (const a of unifiedAssets) {
      const match = a.publicBalances.find(
        b => b.chainId === cexAsset.chainId && b.denom === cexAsset.sourceDenom,
      );
      if (!match) continue;
      const displayAmount = pnum(match.valueView).toNumber();
      if (!Number.isFinite(displayAmount) || displayAmount <= 0) continue;
      // Narrow the UnifiedAsset to just the matching balance so
      // useIbcShield reads the correct chainId/denom from
      // publicBalances[0].
      return { ...a, publicBalances: [match] } satisfies UnifiedAsset;
    }
    return null;
  }, [cexAsset.chainId, cexAsset.sourceDenom, isCosmosConnected, unifiedAssets]);

  if (!narrowed) return null;
  return <OneClickShieldPanel asset={narrowed} cexAsset={cexAsset} />;
};

type Phase = 'idle' | 'pending' | 'success' | 'error';

const explorerUrl = (chainId: string | undefined, hash: string): string | null => {
  if (chainId === 'injective-1') return `https://explorer.injective.network/transaction/${hash}`;
  if (chainId === 'noble-1') return `https://mintscan.io/noble/tx/${hash}`;
  return null;
};

const NATIVE_GAS_BUFFER: Record<string, string> = {
  'injective-1': '0.01',
  'noble-1': '0.1',
};

const FEE_DENOM: Record<string, string> = {
  'injective-1': 'inj',
  'noble-1': 'uusdc',
};

/**
 * Power-user affordance. Only rendered when the source-chain balance is
 * non-zero — the check happens in `OneClickShieldSection` above so
 * `useIbcShield` here always runs.
 *
 * Copy in this panel is allowed to say "shield" — this is the advanced
 * wallet-user flow, not the CEX-guided one.
 */
const OneClickShieldPanel = ({
  asset,
  cexAsset,
}: {
  asset: UnifiedAsset;
  cexAsset: CexAsset;
}) => {
  const {
    shield,
    isReady,
    isPending,
    error,
    isWalletConnected,
    penumbraReceiver,
    sourceChainId,
    exponent,
    reset,
  } = useIbcShield(asset);

  const firstBalance = asset.publicBalances[0];
  const displayBalance = firstBalance ? pnum(firstBalance.valueView).toString() : '0';

  const maxAmount = useMemo(() => {
    const balance = new BigNumber(displayBalance);
    if (!balance.isFinite() || balance.lte(0)) return '0';
    const feeDenom = sourceChainId ? FEE_DENOM[sourceChainId] : undefined;
    const isFeeToken = feeDenom && firstBalance?.denom === feeDenom;
    const buffer = isFeeToken && sourceChainId ? NATIVE_GAS_BUFFER[sourceChainId] : undefined;
    const withBuffer = buffer ? balance.minus(buffer) : balance;
    return withBuffer.lte(0) ? '0' : withBuffer.toFixed();
  }, [displayBalance, sourceChainId, firstBalance?.denom]);

  const [amount, setAmount] = useState(displayBalance);
  const [phase, setPhase] = useState<Phase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);

  const amountBn = new BigNumber(amount || '0');
  const balanceBn = new BigNumber(displayBalance);
  const amountValid =
    amountBn.isFinite() && amountBn.gt(0) && amountBn.lte(balanceBn) && exponent > 0;

  const onSubmit = useCallback(async () => {
    setPhase('pending');
    setTxHash(null);
    try {
      const { txHash: hash } = await shield(amount);
      setTxHash(hash);
      setPhase('success');
    } catch {
      setPhase('error');
    }
  }, [amount, shield]);

  const disabledReason = (() => {
    if (!isWalletConnected) {
      return `Connect your ${cexAsset.network} wallet to sign the transfer`;
    }
    if (!penumbraReceiver) return 'Waiting for a Penumbra deposit address…';
    if (!amountValid) return 'Enter a valid amount';
    return null;
  })();

  const explorer = txHash ? explorerUrl(sourceChainId, txHash) : null;

  const handleReset = () => {
    setPhase('idle');
    setTxHash(null);
    reset();
  };

  return (
    <div className='flex flex-col gap-3 rounded-xl border border-other-tonal-stroke bg-accent-radial-background/30 p-4'>
      <div className='flex items-center gap-2'>
        <Shield className='h-4 w-4 text-primary-main' />
        <Text variant='strong' color='text.primary'>
          Shield {cexAsset.symbol} into Penumbra
        </Text>
      </div>
      <Text small color='text.secondary'>
        One signature moves it from your wallet into your shielded balance.
      </Text>

      {phase === 'success' ? (
        <div className='flex flex-col gap-2 rounded-lg bg-other-tonal-fill5 p-3'>
          <Text small color='text.primary'>
            Shield sent. Funds arrive on Penumbra in ~1 minute.
          </Text>
          {txHash && <PrivateTxHash hash={txHash} explorerUrl={explorer} />}
          <div className='pt-1'>
            <Button actionType='default' priority='secondary' onClick={handleReset}>
              Shield more
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className='flex flex-col gap-2'>
            <TextInput
              value={amount}
              onChange={setAmount}
              type='text'
              disabled={phase === 'pending'}
              endAdornment={
                <button
                  type='button'
                  onClick={() => setAmount(maxAmount)}
                  className='rounded-md px-2 py-1 text-xs text-primary-main hover:bg-other-tonal-fill10'
                  disabled={phase === 'pending'}
                >
                  Max
                </button>
              }
            />
            <Text detail color='text.secondary'>
              Balance: {displayBalance} {cexAsset.symbol}
            </Text>
          </div>

          {phase === 'error' && error && (
            <Text small color='destructive.light'>
              {error.message}
            </Text>
          )}

          <Button
            actionType='accent'
            priority='primary'
            icon={Shield}
            disabled={!isReady || !amountValid || isPending}
            onClick={() => {
              void onSubmit();
            }}
          >
            {phase === 'error' ? 'Retry shield' : `Shield ${cexAsset.symbol}`}
          </Button>

          {disabledReason && !isPending && (
            <Text detail color='text.secondary'>
              {disabledReason}
            </Text>
          )}
        </>
      )}
    </div>
  );
};

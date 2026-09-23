import { useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import BigNumber from 'bignumber.js';
import { Shield } from 'lucide-react';

import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { pnum } from '@penumbra-zone/types/pnum';

import type { UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets.ts';
import { useIbcShield } from '@/features/deposit/use-ibc-shield';
import { useRegistry } from '@/shared/api/registry.tsx';

interface NativeShieldDialogProps {
  asset: UnifiedAsset;
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'idle' | 'pending' | 'success' | 'error';

/**
 * A small gas buffer subtracted from the "Max" preset for native (gas-token)
 * balances so the user isn't left with a signed tx that can't pay fees. Only
 * applied when the asset denom matches the source chain's fee currency; for
 * everything else the full balance is offered.
 */
const NATIVE_GAS_BUFFER: Record<string, string> = {
  'injective-1': '0.01', // ~10^16 wei, comfortably above INJ tx cost
  'noble-1': '0.1', // 0.1 USDC — Noble fees are paid in uusdc
};

/**
 * Chains whose native fee denom equals the asset denom. When it does, the
 * "Max" button subtracts NATIVE_GAS_BUFFER; otherwise, Max = full balance.
 */
const FEE_DENOM: Record<string, string> = {
  'injective-1': 'inj',
  'noble-1': 'uusdc',
};

const explorerUrl = (chainId: string | undefined, hash: string): string | null => {
  if (chainId === 'injective-1') return `https://explorer.injective.network/transaction/${hash}`;
  if (chainId === 'noble-1') return `https://mintscan.io/noble/tx/${hash}`;
  return null;
};

const truncate = (s: string) => (s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s);

/**
 * Native ICS-20 shield dialog. Signs a MsgTransfer on the source chain
 * (Injective / Noble) sending directly to a fresh Penumbra ephemeral
 * address. No third-party bridge in the middle.
 */
export const NativeShieldDialog = ({ asset, isOpen, onClose }: NativeShieldDialogProps) => {
  const { data: registry } = useRegistry();

  const {
    shield,
    isReady,
    isPending,
    error,
    penumbraReceiver,
    chainName,
    chainDisplayName,
    sourceChainId,
    sender,
    isWalletConnected,
    exponent,
    reset,
  } = useIbcShield(asset);

  const firstBalance = asset.publicBalances[0];
  const displayBalance = firstBalance ? pnum(firstBalance.valueView).toString() : '0';

  const connection = useMemo(
    () => registry.ibcConnections.find(c => c.chainId === sourceChainId),
    [registry, sourceChainId],
  );
  const chainImage = connection?.images[0]?.png ?? connection?.images[0]?.svg ?? '';

  const [amount, setAmount] = useState(displayBalance);
  const [phase, setPhase] = useState<Phase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);

  const maxAmount = useMemo(() => {
    const balance = new BigNumber(displayBalance);
    if (!balance.isFinite() || balance.lte(0)) return '0';
    const feeDenom = sourceChainId ? FEE_DENOM[sourceChainId] : undefined;
    const assetIsFeeToken = feeDenom && firstBalance?.denom === feeDenom;
    const buffer = assetIsFeeToken && sourceChainId ? NATIVE_GAS_BUFFER[sourceChainId] : undefined;
    const withBuffer = buffer ? balance.minus(buffer) : balance;
    return withBuffer.lte(0) ? '0' : withBuffer.toFixed();
  }, [displayBalance, sourceChainId, firstBalance?.denom]);

  const amountBn = new BigNumber(amount || '0');
  const balanceBn = new BigNumber(displayBalance);
  const amountValid =
    amountBn.isFinite() && amountBn.gt(0) && amountBn.lte(balanceBn) && exponent > 0;

  const handleClose = useCallback(() => {
    if (isPending) return; // don't let the user close mid-broadcast
    setPhase('idle');
    setTxHash(null);
    reset();
    onClose();
  }, [isPending, onClose, reset]);

  const onSubmit = useCallback(async () => {
    setPhase('pending');
    setTxHash(null);
    try {
      const { txHash: hash } = await shield(amount);
      setTxHash(hash);
      setPhase('success');
    } catch {
      // useIbcShield already stored the error; surface via `error` below.
      setPhase('error');
    }
  }, [amount, shield]);

  const disabledReason = (() => {
    if (!chainName) return `No IBC route registered for ${sourceChainId ?? 'this asset'}`;
    if (!isWalletConnected) {
      return `Connect your Cosmos wallet on ${chainDisplayName ?? chainName} to sign the transfer`;
    }
    if (!penumbraReceiver) return 'Waiting for a Penumbra deposit address…';
    if (!amountValid) return 'Enter a valid amount';
    return null;
  })();

  const explorer = txHash ? explorerUrl(sourceChainId, txHash) : null;

  return (
    <Dialog isOpen={isOpen} onClose={handleClose}>
      <Dialog.Content title={`Shield ${asset.symbol}`}>
        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-2'>
            {chainImage && (
              <Image
                src={chainImage}
                width={20}
                height={20}
                alt={chainDisplayName ?? chainName ?? ''}
              />
            )}
            <Text small color='text.secondary'>
              From {chainDisplayName ?? chainName ?? 'source chain'} → Penumbra
            </Text>
          </div>

          {phase === 'success' ? (
            <div className='flex flex-col gap-2 rounded-lg bg-other-tonal-fill5 p-4'>
              <Text variant='strong' color='text.primary'>
                Transfer broadcast
              </Text>
              <Text small color='text.secondary'>
                Your shield will land in ~1 minute once Penumbra relays the packet.
              </Text>
              {explorer ? (
                <a
                  href={explorer}
                  target='_blank'
                  rel='noreferrer'
                  className='font-mono text-xs break-all text-primary-main hover:underline'
                >
                  {txHash}
                </a>
              ) : (
                <span className='font-mono text-xs break-all text-text-secondary'>{txHash}</span>
              )}
              <div className='pt-2'>
                <Button actionType='default' priority='secondary' onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className='flex flex-col gap-2'>
                <Text variant='body' color='text.primary'>
                  Amount
                </Text>
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
                  Balance: {displayBalance} {asset.symbol}
                </Text>
              </div>

              <div className='flex flex-col gap-1 rounded-lg bg-other-tonal-fill5 p-3'>
                <Text detail color='text.secondary'>
                  Deposit address (single-use, generated fresh)
                </Text>
                <span className='font-mono text-xs break-all text-text-primary'>
                  {penumbraReceiver ? truncate(penumbraReceiver) : 'Connect Zafu to generate…'}
                </span>
                {sender && (
                  <Text detail color='text.secondary'>
                    Signing as {truncate(sender)}
                  </Text>
                )}
                <Text detail color='text.secondary'>
                  Estimated arrival: ~30–60s after signing
                </Text>
              </div>

              {phase === 'error' && error && (
                <Text small color='destructive.light'>
                  {error.message}
                </Text>
              )}

              {phase === 'pending' && (
                <Text small color='text.secondary'>
                  Waiting for signature → broadcasting → awaiting confirmation…
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
                {phase === 'error' ? 'Retry shield' : `Shield ${asset.symbol}`}
              </Button>

              {disabledReason && !isPending && (
                <Text detail color='text.secondary'>
                  {disabledReason}
                </Text>
              )}
            </>
          )}
        </div>
      </Dialog.Content>
    </Dialog>
  );
};

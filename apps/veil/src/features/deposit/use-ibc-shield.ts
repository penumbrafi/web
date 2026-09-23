import { useCallback, useMemo, useState } from 'react';
import { useChain } from '@cosmos-kit/react';
import BigNumber from 'bignumber.js';
import type { MsgTransferEncodeObject } from '@cosmjs/stargate';

import type { UnifiedAsset } from '@/pages/portfolio/api/use-unified-assets.ts';
import { useRegistry } from '@/shared/api/registry.tsx';
import { SUPPORTED_CHAINS } from '@/features/cosmos/supported-chains';
import { useDepositAddress } from './use-deposit-address';

interface UseIbcShieldResult {
  /** Ready to build & broadcast: registry entry + wallet + deposit address are all present. */
  isReady: boolean;
  /** In-flight signAndBroadcast. */
  isPending: boolean;
  /** Last error (build-time or broadcast-time). */
  error: Error | null;
  /** The Penumbra bech32m the packet's receiver is set to (single-use ephemeral). */
  penumbraReceiver: string | undefined;
  /** cosmos-kit source chain name (e.g. 'injective'), null if unresolved. */
  chainName: string | null;
  /** Human-readable source chain label (e.g. 'Injective'), from Penumbra registry. */
  chainDisplayName: string | undefined;
  /** Source chain id (e.g. 'injective-1'). */
  sourceChainId: string | undefined;
  /** Bech32 sender address from cosmos-kit's connected wallet on the source chain. */
  sender: string | undefined;
  /** True if the cosmos wallet is connected to the source chain. */
  isWalletConnected: boolean;
  /** Display exponent (e.g. 18 for INJ, 6 for USDC). */
  exponent: number;
  shield: (amountDisplay: string) => Promise<{ txHash: string }>;
  reset: () => void;
}

/**
 * Native ICS-20 shield: builds a MsgTransfer on the source chain sending
 * to a fresh Penumbra ephemeral address. Replaces Skip's widget for the
 * chains we hold direct IBC channels to.
 *
 * IMPORTANT: `sourceChannel` MUST be the counterparty channel id — the
 * channel on the source chain that points at Penumbra. In Penumbra's
 * registry that lives at `ibcConnection.counterpartyChannelId`
 * (`.channelId` is Penumbra's own side of the same channel).
 */
export const useIbcShield = (asset: UnifiedAsset): UseIbcShieldResult => {
  const { data: registry } = useRegistry();

  const firstBalance = asset.publicBalances[0];
  const sourceChainId = firstBalance?.chainId;
  const sourceDenom = firstBalance?.denom;

  const connection = useMemo(
    () => registry.ibcConnections.find(c => c.chainId === sourceChainId),
    [registry, sourceChainId],
  );

  // cosmos-kit needs the chain-registry `chain_name` slug — resolve via
  // our curated SUPPORTED_CHAINS so we don't pull the full chain-registry
  // barrel and don't have to guess the slug from chainId.
  const chainName = useMemo(() => {
    if (!sourceChainId) return null;
    return SUPPORTED_CHAINS.find(c => c.chain_id === sourceChainId)?.chain_name ?? null;
  }, [sourceChainId]);

  // useChain requires a non-empty chainName registered with the provider.
  // Pass a harmless placeholder when we haven't resolved one yet; guards
  // below prevent us from actually calling into that empty chain.
  const chain = useChain(chainName ?? SUPPORTED_CHAINS[0]?.chain_name ?? 'noble');

  const { data: penumbraReceiver } = useDepositAddress();

  const exponent = useMemo(() => {
    const units = asset.metadata.denomUnits;
    // Skip exponent 0 (base units); the first positive one is the display exponent.
    return units.find(u => u.exponent > 0)?.exponent ?? 0;
  }, [asset.metadata.denomUnits]);

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isWalletConnected = Boolean(chainName) && chain.isWalletConnected;
  const sender = chainName ? chain.address : undefined;

  const isReady = Boolean(
    chainName &&
      connection?.counterpartyChannelId &&
      sender &&
      isWalletConnected &&
      penumbraReceiver &&
      sourceDenom &&
      exponent > 0,
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPending(false);
  }, []);

  const shield = useCallback(
    async (amountDisplay: string): Promise<{ txHash: string }> => {
      setError(null);

      if (!sourceChainId) {
        throw new Error('No source chain resolved for this asset');
      }
      if (!connection?.counterpartyChannelId) {
        throw new Error(
          `Penumbra registry has no IBC connection for ${sourceChainId}. Cannot build a shield transfer.`,
        );
      }
      if (!chainName) {
        throw new Error(`Source chain ${sourceChainId} is not in the veil cosmos provider set`);
      }
      if (!chain.isWalletConnected || !chain.address) {
        throw new Error(
          `Connect your Cosmos wallet and approve ${chain.chain.pretty_name ?? chainName} in Keplr/Leap first.`,
        );
      }
      if (!penumbraReceiver) {
        throw new Error(
          'Could not generate a Penumbra deposit address. Reconnect your Penumbra wallet and retry.',
        );
      }
      if (!sourceDenom) {
        throw new Error('Missing source-chain denom for this asset');
      }
      if (exponent <= 0) {
        throw new Error(`Missing display exponent for ${asset.symbol}`);
      }

      // Convert display units → base units as an integer string. Round DOWN
      // so a user typing their exact balance never overshoots into an
      // insufficient-funds error at signing time.
      const baseAmount = new BigNumber(amountDisplay)
        .multipliedBy(new BigNumber(10).pow(exponent))
        .integerValue(BigNumber.ROUND_DOWN)
        .toFixed(0);

      if (!baseAmount || baseAmount === '0' || baseAmount.startsWith('-')) {
        throw new Error('Amount must be greater than zero');
      }

      // 30-minute IBC timeout, expressed as nanoseconds since epoch.
      // Off-by-1e6 here would time the packet out immediately.
      const timeoutTimestamp = BigInt(Date.now() + 30 * 60 * 1000) * BigInt(1_000_000);

      const msg: MsgTransferEncodeObject = {
        typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
        value: {
          sourcePort: 'transfer',
          // Source chain's own channel back to Penumbra, NOT Penumbra's side.
          sourceChannel: connection.counterpartyChannelId,
          token: { denom: sourceDenom, amount: baseAmount },
          sender: chain.address,
          // Full Penumbra bech32m — the FungibleTokenPacketData receiver
          // field. Must not be truncated or normalized.
          receiver: penumbraReceiver,
          timeoutTimestamp,
          memo: '',
        },
      };

      setIsPending(true);
      try {
        const client = await chain.getSigningStargateClient();
        // 'auto' triggers gas simulation using cosmos-kit's per-chain
        // gasPrice defaults (Injective: 500000000inj, Noble: 0.1uusdc).
        const result = await client.signAndBroadcast(
          chain.address,
          [msg],
          'auto',
          'Shield to Penumbra via veil',
        );
        if (result.code !== 0) {
          throw new Error(`IBC transfer failed (code ${result.code}): ${result.rawLog ?? ''}`);
        }
        return { txHash: result.transactionHash };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [
      asset.symbol,
      chain,
      chainName,
      connection,
      exponent,
      penumbraReceiver,
      sourceChainId,
      sourceDenom,
    ],
  );

  return {
    isReady,
    isPending,
    error,
    penumbraReceiver,
    chainName,
    chainDisplayName: connection?.displayName,
    sourceChainId,
    sender,
    isWalletConnected,
    exponent,
    shield,
    reset,
  };
};

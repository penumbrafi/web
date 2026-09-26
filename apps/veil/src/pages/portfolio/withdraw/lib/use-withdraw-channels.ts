import { useQuery } from '@tanstack/react-query';
import type { Chain } from '@penumbrafi/registry';
import { IbcChannelService, IbcClientService, IbcConnectionService } from '@penumbra-zone/protobuf';
import { State } from '@penumbra-zone/protobuf/ibc/core/channel/v1/channel_pb';
import {
  ClientState,
  ConsensusState,
} from '@penumbra-zone/protobuf/ibc/lightclients/tendermint/v1/tendermint_pb';
import { penumbra } from '@/shared/const/penumbra';
import { useRegistry } from '@/shared/api/registry.tsx';

/**
 * Whether a transfer sent out over this channel can actually land. The channel
 * reporting OPEN isn't enough: if Penumbra's light client of the counterparty
 * is frozen or past its trusting period, nobody can relay the packet in or
 * prove its timeout, and the funds sit in escrow until the client is revived.
 */
export const channelCanCarry = async (channelId: string): Promise<boolean> => {
  const { channel } = await penumbra.service(IbcChannelService).channel({
    portId: 'transfer',
    channelId,
  });
  if (channel?.state !== State.OPEN) {
    return false;
  }

  const connectionId = channel.connectionHops[0];
  if (!connectionId) {
    return false;
  }
  const { connection } = await penumbra.service(IbcConnectionService).connection({
    connectionId,
  });
  const clientId = connection?.clientId;
  if (!clientId) {
    return false;
  }

  const { clientState: anyClient } = await penumbra
    .service(IbcClientService)
    .clientState({ clientId });
  const client = new ClientState();
  if (!anyClient?.unpackTo(client)) {
    return false;
  }
  if (client.frozenHeight && client.frozenHeight.revisionHeight !== 0n) {
    return false;
  }
  const latest = client.latestHeight;
  const trustingSecs = client.trustingPeriod?.seconds;
  if (!latest || trustingSecs === undefined) {
    return false;
  }

  const { consensusState: anyConsensus } = await penumbra.service(IbcClientService).consensusState({
    clientId,
    revisionNumber: latest.revisionNumber,
    revisionHeight: latest.revisionHeight,
  });
  const consensus = new ConsensusState();
  if (!anyConsensus?.unpackTo(consensus) || !consensus.timestamp) {
    return false;
  }
  return consensus.timestamp.seconds + trustingSecs > BigInt(Math.floor(Date.now() / 1000));
};

/**
 * Chains a withdrawal can reach right now: every registry connection whose
 * channel is open and whose light client is live. UM picks from these; an
 * asset returning to its source chain needs its channel among them. Entries
 * the registry already marks expired are skipped without asking the chain.
 */
export const useWithdrawChannels = (enabled = true) => {
  const { data: registry } = useRegistry();
  const candidates = registry.ibcConnections.filter(c => c.status !== 'expired');

  return useQuery<Chain[]>({
    queryKey: ['withdrawChannels', candidates.map(c => c.channelId)],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const live = await Promise.all(
        candidates.map(c => channelCanCarry(c.channelId).catch(() => false)),
      );
      return candidates.filter((_, i) => live[i]);
    },
  });
};

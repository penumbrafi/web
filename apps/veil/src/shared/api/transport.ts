import { ChainRegistryClient } from '@penumbrafi/registry';
import { sample } from 'lodash';
import { useQuery } from '@tanstack/react-query';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { penumbra } from '@/shared/const/penumbra.ts';
import { connectionStore } from '@/shared/model/connection';
import { queryClient } from '@/shared/const/queryClient';
import { useClientEnv } from './env';
import { ClientEnv } from './env/types';

const registryRpcChoices = async (env: ClientEnv) => {
  // If the operator pinned a specific endpoint via env, always prefer it.
  // Otherwise the mainnet path picks a random community RPC from the
  // chain-registry, many of which don't allow CORS for our origin
  // (problematic during local dev and on our own deploy).
  if (env.PENUMBRA_GRPC_ENDPOINT) {
    return [env.PENUMBRA_GRPC_ENDPOINT];
  }
  if (env.PENUMBRA_CHAIN_ID === 'penumbra-1') {
    const chainRegistryClient = new ChainRegistryClient();
    const { rpcs } = await chainRegistryClient.remote.globals();
    return rpcs.map(r => r.url);
  }
  throw new Error(`No rpcs for chain id: ${env.PENUMBRA_CHAIN_ID}`);
};

enum TransportType {
  PRAX,
  GRPC_WEB,
}

const grpcTransportQueryFn = async (env: ClientEnv) => {
  if (connectionStore.connected && penumbra.transport) {
    return { transport: penumbra.transport, type: TransportType.PRAX };
  }

  const rpcChoices = await registryRpcChoices(env);
  const randomRpc = sample(rpcChoices);
  if (!randomRpc) {
    throw new Error('No rpcs in remote globals');
  }

  return {
    transport: createGrpcWebTransport({
      baseUrl: randomRpc,
    }),
    type: TransportType.GRPC_WEB,
  };
};

const getGrpcQueryOptions = (env: ClientEnv) => ({
  queryKey: ['grpcTransport', connectionStore.connected],
  queryFn: () => grpcTransportQueryFn(env),
  staleTime: Infinity,
});

export const getGrpcTransport = (env: ClientEnv) => {
  return queryClient.fetchQuery(getGrpcQueryOptions(env));
};

export const useGrpcTransport = () => {
  const env = useClientEnv();
  return useQuery(getGrpcQueryOptions(env));
};

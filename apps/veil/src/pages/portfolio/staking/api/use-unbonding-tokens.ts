import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { ValueView, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { getValueView as getValueViewFromUnbondingTokensByAddressIndexResponse } from '@penumbra-zone/getters/unbonding-tokens-by-address-index-response';
import { getAmount } from '@penumbra-zone/getters/value-view';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { splitLoHi } from '@penumbra-zone/types/lo-hi';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useStakingTokenMetadata } from '@/shared/api/registry';

export interface UnbondingTokensForAccount {
  claimable: { total: ValueView; tokens: ValueView[] };
  notYetClaimable: { total: ValueView; tokens: ValueView[] };
}

const zeroValueView = (metadata: Metadata): ValueView =>
  new ValueView({
    valueView: {
      case: 'knownAssetId',
      value: { amount: { lo: 0n, hi: 0n }, metadata },
    },
  });

const sumAsValueView = (tokens: ValueView[], stakingMetadata: Metadata): ValueView => {
  const sum = tokens.reduce<bigint>((prev, t) => prev + joinLoHiAmount(getAmount(t)), 0n);
  return new ValueView({
    valueView: {
      case: 'knownAssetId',
      value: { amount: splitLoHi(sum), metadata: stakingMetadata },
    },
  });
};

/**
 * Loads unbonding tokens for the currently-selected subaccount and partitions
 * them into `claimable` (the unbonding period has elapsed) and `notYetClaimable`
 * (still in the unbonding window). The totals are expressed in the staking
 * token (UM) so the UI can show "you'll get back X UM once you claim".
 */
export const useUnbondingTokens = () => {
  const subaccount = connectionStore.subaccount;
  const connected = connectionStore.connected;
  const { data: stakingTokenMetadata } = useStakingTokenMetadata();

  return useQuery<UnbondingTokensForAccount | undefined>({
    queryKey: ['view-service-unbonding-tokens', subaccount],
    enabled: connected && !!stakingTokenMetadata,
    staleTime: 30_000,
    queryFn: async () => {
      const addressIndex = new AddressIndex({ account: subaccount });
      const claimable: ValueView[] = [];
      const notYetClaimable: ValueView[] = [];

      for await (const response of penumbra
        .service(ViewService)
        .unbondingTokensByAddressIndex({ addressIndex })) {
        const valueView = getValueViewFromUnbondingTokensByAddressIndexResponse(response);
        if (response.claimable) {
          claimable.push(valueView);
        } else {
          notYetClaimable.push(valueView);
        }
      }

      return {
        claimable: {
          total:
            claimable.length === 0
              ? zeroValueView(stakingTokenMetadata)
              : sumAsValueView(claimable, stakingTokenMetadata),
          tokens: claimable,
        },
        notYetClaimable: {
          total:
            notYetClaimable.length === 0
              ? zeroValueView(stakingTokenMetadata)
              : sumAsValueView(notYetClaimable, stakingTokenMetadata),
          tokens: notYetClaimable,
        },
      };
    },
  });
};

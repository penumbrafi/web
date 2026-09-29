import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import {
  DelegationsByAddressIndexRequest_Filter,
  BalancesResponse,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { getValueView as getValueViewFromDelegationsByAddressIndexResponse } from '@penumbra-zone/getters/delegations-by-address-index-response';
import { getValidatorInfoFromValueView, getAmount } from '@penumbra-zone/getters/value-view';
import { joinLoHiAmount } from '@penumbrafi/types/amount';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

const byBalanceDesc = (a: ValueView, b: ValueView) =>
  Number(joinLoHiAmount(getAmount(b)) - joinLoHiAmount(getAmount(a)));

/**
 * Loads the user's delegation tokens for the currently-selected subaccount.
 *
 * Each `ValueView` returned wraps a `delegation_*` token whose embedded
 * metadata also surfaces the underlying `ValidatorInfo` — that's how we
 * render validator name / commission / state alongside the balance without
 * a second round-trip.
 */
export const useDelegations = (balances?: BalancesResponse[]) => {
  const subaccount = connectionStore.subaccount;
  const connected = connectionStore.connected;

  return useQuery<ValueView[]>({
    // Tie the cache key to balances so the list refetches after delegations change.
    queryKey: ['view-service-delegations', subaccount, balances?.length ?? 0],
    enabled: connected,
    staleTime: 30_000,
    queryFn: async () => {
      const addressIndex = new AddressIndex({ account: subaccount });
      const delegations: ValueView[] = [];
      for await (const response of penumbra.service(ViewService).delegationsByAddressIndex({
        addressIndex,
        filter: DelegationsByAddressIndexRequest_Filter.ALL_ACTIVE_WITH_NONZERO_BALANCES,
      })) {
        const delegation = getValueViewFromDelegationsByAddressIndexResponse(response);
        // Confirm the delegation has a validator info attached; if not, skip it.
        try {
          getValidatorInfoFromValueView(delegation);
        } catch {
          continue;
        }
        delegations.push(delegation);
      }
      delegations.sort(byBalanceDesc);
      return delegations;
    },
  });
};

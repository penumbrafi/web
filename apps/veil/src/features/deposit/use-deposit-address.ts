import { useQuery } from '@tanstack/react-query';
import { ViewService } from '@penumbra-zone/protobuf';
import { bech32mAddress } from '@penumbra-zone/bech32m/penumbra';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

/**
 * Resolves a fresh ephemeral Penumbra address for inbound deposits.
 *
 * `ephemeralAddress` (vs `addressByIndex`) is critical: each deposit lands at
 * a one-shot bech32 the source chain has never seen, so Noble /
 * Skip route partners can't link two deposits to the same sub-account. We
 * pre-fill this into the Skip widget's `connectedAddresses` so the user
 * never has to copy or paste an address.
 *
 * The query rotates whenever its key changes — reopen the dialog after the
 * staleTime window and you get a brand new address.
 */
export const useDepositAddress = () => {
  const subaccount = connectionStore.subaccount;
  const connected = connectionStore.connected;

  return useQuery({
    queryKey: ['deposit-address', 'ephemeral', subaccount],
    enabled: connected,
    staleTime: 60_000,
    queryFn: async () => {
      const { address } = await penumbra.service(ViewService).ephemeralAddress({
        addressIndex: { account: subaccount },
      });
      if (!address) {
        throw new Error('view service returned no address for current subaccount');
      }
      return bech32mAddress(address);
    },
  });
};

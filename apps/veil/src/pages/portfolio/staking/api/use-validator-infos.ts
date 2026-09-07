import { useQuery } from '@tanstack/react-query';
import { StakeService } from '@penumbra-zone/protobuf';
import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import {
  getVotingPowerByValidatorInfo,
  VotingPowerAsIntegerPercentage,
} from '@penumbra-zone/types/staking';
import { getVotingPowerFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';

export interface ValidatorInfosResult {
  /** All validator infos returned by the chain (active by default). */
  validatorInfos: ValidatorInfo[];
  /**
   * Bech32 identity key → integer percentage of total voting power. Computed
   * once per fetch so consumers can render quickly.
   */
  votingPowerByIdentityKey: Record<string, VotingPowerAsIntegerPercentage>;
}

const sortByVotingPowerDesc = (a: ValidatorInfo, b: ValidatorInfo): number =>
  Number(joinLoHiAmount(getVotingPowerFromValidatorInfo(b))) -
  Number(joinLoHiAmount(getVotingPowerFromValidatorInfo(a)));

/**
 * Streams `StakeService.validatorInfo` to load validator data over the *wallet
 * provider* transport.
 *
 * This is connected-only, and must stay that way. `penumbra.service()` throws
 * `PenumbraProviderNotConnectedError` the moment it is called without a live
 * provider connection, and this query used to run ungated on mount — racing
 * `connectionStore.setup()`, which is async. With a wallet extension installed
 * but not yet re-approved for the origin, the race was reliably lost and
 * react-query cached the rejection, so the page showed
 *
 *   Failed to load validators: PenumbraProviderNotConnectedError: Penumbra
 *   provider chrome-extension://… is not connected
 *
 * permanently, even after the connection came up moments later.
 *
 * Browsing validators does not need a wallet at all — that list comes from our
 * own indexer via the Explore GraphQL API. What genuinely needs the provider is
 * the `ValidatorInfo` protobuf behind a *delegate*: `getRateData` needs the
 * validator's current exchange rate to build the transaction. So this hook is
 * now scoped to what only it can provide, and only once a wallet is connected.
 */
export const useValidatorInfos = () => {
  const connected = connectionStore.connected;

  return useQuery<ValidatorInfosResult>({
    queryKey: ['stake-service-validator-infos'],
    // Never touch the provider transport before the connection handshake has
    // completed. `connected` is set from `penumbra.onConnectionStateChange`,
    // so this flips true only once the provider is genuinely usable.
    enabled: connected,
    // Validator set changes slowly; refresh every minute.
    staleTime: 60_000,
    queryFn: async () => {
      const stream = penumbra.service(StakeService).validatorInfo({ showInactive: false });
      const validatorInfos: ValidatorInfo[] = [];
      for await (const response of stream) {
        if (response.validatorInfo) {
          validatorInfos.push(response.validatorInfo);
        }
      }
      validatorInfos.sort(sortByVotingPowerDesc);
      return {
        validatorInfos,
        votingPowerByIdentityKey: getVotingPowerByValidatorInfo(validatorInfos),
      };
    },
  });
};

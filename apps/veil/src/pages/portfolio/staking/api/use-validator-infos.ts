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
 * Streams `StakeService.validatorInfo` to load every active validator on the
 * chain. Used both for browsing in the validator picker and for computing
 * voting-power percentages used in the existing-delegations list.
 */
export const useValidatorInfos = () => {
  return useQuery<ValidatorInfosResult>({
    queryKey: ['stake-service-validator-infos'],
    // Validator set changes slowly; refresh every minute.
    staleTime: 60_000,
    // Guard against a mount-race with connectionStore.setup(). The service
    // call goes through the wallet provider; without the guard it fires on
    // component mount before `connect(origin)` resolves and throws
    // PenumbraProviderNotConnectedError, which react-query then caches so
    // the error stays permanent even after the handshake completes.
    enabled: connectionStore.connected,
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

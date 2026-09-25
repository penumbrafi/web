import {
  ValidatorInfo,
  ValidatorState_ValidatorStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { Text } from '@penumbra-zone/ui/Text';
import {
  getValidator,
  getIdentityKeyFromValidatorInfo,
  getStateEnumFromValidatorInfo,
} from '@penumbra-zone/getters/validator-info';
import { calculateCommissionAsPercentage } from '@penumbra-zone/types/staking';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { shorten } from '@penumbra-zone/types/string';

const stateLabel = (state: ValidatorState_ValidatorStateEnum): string => {
  switch (state) {
    case ValidatorState_ValidatorStateEnum.ACTIVE:
      return 'Active';
    case ValidatorState_ValidatorStateEnum.INACTIVE:
      return 'Inactive';
    case ValidatorState_ValidatorStateEnum.JAILED:
      return 'Jailed';
    case ValidatorState_ValidatorStateEnum.TOMBSTONED:
      return 'Tombstoned';
    case ValidatorState_ValidatorStateEnum.DEFINED:
      return 'Defined';
    case ValidatorState_ValidatorStateEnum.DISABLED:
      return 'Disabled';
    default:
      return 'Unknown';
  }
};

const stateColor = (state: ValidatorState_ValidatorStateEnum) => {
  switch (state) {
    case ValidatorState_ValidatorStateEnum.ACTIVE:
      return 'success.light' as const;
    case ValidatorState_ValidatorStateEnum.JAILED:
    case ValidatorState_ValidatorStateEnum.TOMBSTONED:
      return 'destructive.light' as const;
    default:
      return 'text.secondary' as const;
  }
};

/**
 * Renders a validator's name + identity-key + state badge + commission.
 * Used inside both the validators table and the existing-delegations list.
 */
export const ValidatorInfoCell = ({
  validatorInfo,
  votingPowerPercentage,
}: {
  validatorInfo: ValidatorInfo;
  votingPowerPercentage?: number;
}) => {
  const validator = getValidator(validatorInfo);
  const identityKey = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(validatorInfo));
  const state = getStateEnumFromValidatorInfo(validatorInfo);
  const commission = calculateCommissionAsPercentage(validatorInfo);

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2'>
        <Text body color='text.primary'>
          {validator.name || 'Unnamed'}
        </Text>
        <Text detailTechnical color={stateColor(state)}>
          {stateLabel(state)}
        </Text>
      </div>
      <Text detailTechnical color='text.secondary'>
        {shorten(identityKey, 16)}
      </Text>
      <div className='flex gap-3'>
        {typeof votingPowerPercentage === 'number' && (
          <Text detail color='text.secondary'>
            VP: {votingPowerPercentage}%
          </Text>
        )}
        <Text detail color='text.secondary'>
          Commission: {commission}%
        </Text>
      </div>
    </div>
  );
};

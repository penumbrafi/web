'use client';

import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { Table } from '@penumbra-zone/ui/Table';
import { ValueView, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getValidatorInfoFromValueView } from '@penumbra-zone/getters/value-view';
import {
  getIdentityKeyFromValidatorInfo,
  getValidator,
} from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { VotingPowerAsIntegerPercentage } from '@penumbra-zone/types/staking';
import { ValidatorInfoCell } from './validator-info-cell';
import { StakingActions } from './staking-actions';
import { StakingFormDialog } from './form-dialog';

export interface DelegationsListProps {
  delegations: ValueView[];
  votingPowerByIdentityKey: Record<string, VotingPowerAsIntegerPercentage>;
  stakingTokens?: ValueView;
  stakingTokenMetadata?: Metadata;
}

export const DelegationsList = observer(
  ({
    delegations,
    votingPowerByIdentityKey,
    stakingTokens,
    stakingTokenMetadata,
  }: DelegationsListProps) => {
    if (delegations.length === 0) {
      return (
        <div className='flex flex-col items-center gap-2 py-8'>
          <Text color='text.secondary'>No delegations yet for this subaccount.</Text>
          <Text small color='text.secondary'>
            Delegate to a validator below to start earning staking rewards.
          </Text>
        </div>
      );
    }

    return (
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Validator</Table.Th>
            <Table.Th hAlign='right'>Delegation tokens</Table.Th>
            <Table.Th hAlign='right'>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {delegations.map(delegation => {
            const validatorInfo = getValidatorInfoFromValueView(delegation);
            const validator = getValidator(validatorInfo);
            const identityKey = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(validatorInfo));
            const vp = votingPowerByIdentityKey[identityKey];

            return (
              <Table.Tr key={identityKey}>
                <Table.Td>
                  <ValidatorInfoCell validatorInfo={validatorInfo} votingPowerPercentage={vp} />
                </Table.Td>
                <Table.Td hAlign='right'>
                  <ValueViewComponent valueView={delegation} priority='primary' />
                </Table.Td>
                <Table.Td hAlign='right'>
                  <div className='flex justify-end'>
                    <StakingActions
                      validatorInfo={validatorInfo}
                      stakingTokens={stakingTokens}
                      delegationTokens={delegation}
                    />
                  </div>
                  <StakingFormDialog
                    validator={validator}
                    votingPowerPercentage={vp ?? 0}
                    stakingTokens={stakingTokens}
                    delegationTokens={delegation}
                    stakingTokenMetadata={stakingTokenMetadata}
                    allDelegations={delegations}
                  />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  },
);

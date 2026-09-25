'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Search } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { Table } from '@penumbra-zone/ui/Table';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { ValueView, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  getValidator,
  getIdentityKeyFromValidatorInfo,
} from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { isDelegationTokenForValidator, VotingPowerAsIntegerPercentage } from '@penumbra-zone/types/staking';
import { ValidatorInfoCell } from './validator-info-cell';
import { StakingActions } from './staking-actions';
import { StakingFormDialog } from './form-dialog';

export interface ValidatorsTableProps {
  validatorInfos: ValidatorInfo[];
  votingPowerByIdentityKey: Record<string, VotingPowerAsIntegerPercentage>;
  delegations: ValueView[];
  stakingTokens?: ValueView;
  stakingTokenMetadata?: Metadata;
  loading?: boolean;
}

export const ValidatorsTable = observer(
  ({
    validatorInfos,
    votingPowerByIdentityKey,
    delegations,
    stakingTokens,
    stakingTokenMetadata,
    loading,
  }: ValidatorsTableProps) => {
    const [filter, setFilter] = useState('');

    const visible = useMemo(() => {
      if (!filter.trim()) {
        return validatorInfos;
      }
      const f = filter.trim().toLowerCase();
      return validatorInfos.filter(info => {
        const validator = getValidator(info);
        if (validator.name.toLowerCase().includes(f)) {
          return true;
        }
        const identity = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(info));
        return identity.toLowerCase().includes(f);
      });
    }, [filter, validatorInfos]);

    let content: ReactNode;
    if (loading && validatorInfos.length === 0) {
      content = (
        <div className='py-8 text-center'>
          <Text color='text.secondary'>Loading validators…</Text>
        </div>
      );
    } else if (visible.length === 0) {
      content = (
        <div className='py-8 text-center'>
          <Text color='text.secondary'>No validators match your filter.</Text>
        </div>
      );
    } else {
      content = (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Validator</Table.Th>
              <Table.Th hAlign='right'>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map(info => {
              const validator = getValidator(info);
              const identityKey = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(info));
              const vp = votingPowerByIdentityKey[identityKey];
              const existingDelegation = delegations.find(d =>
                isDelegationTokenForValidator(d, info),
              );

              return (
                <Table.Tr key={identityKey}>
                  <Table.Td>
                    <ValidatorInfoCell
                      validatorInfo={info}
                      votingPowerPercentage={vp}
                    />
                  </Table.Td>
                  <Table.Td hAlign='right'>
                    <div className='flex justify-end'>
                      <StakingActions
                        validatorInfo={info}
                        stakingTokens={stakingTokens}
                        delegationTokens={existingDelegation}
                        delegateOnly={!existingDelegation}
                      />
                    </div>
                    <StakingFormDialog
                      validator={validator}
                      votingPowerPercentage={vp ?? 0}
                      stakingTokens={stakingTokens}
                      delegationTokens={existingDelegation}
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
    }

    return (
      <div className='flex flex-col gap-3'>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder='Search by validator name or identity key…'
          startAdornment={<Search size={16} />}
        />

        {content}
      </div>
    );
  },
);

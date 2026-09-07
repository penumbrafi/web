'use client';

import { observer } from 'mobx-react-lite';
import { CircleAlert } from 'lucide-react';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { Validator } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { ValueView, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getIdentityKey } from '@penumbra-zone/getters/validator';
import { getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { getFormattedAmtFromValueView } from '@penumbra-zone/types/value-view';
import { stakingStore } from '../model/staking-store';
import { shorten } from '@penumbra-zone/types/string';

export interface StakingFormDialogProps {
  validator: Validator;
  /** Voting power of the validator, as an integer 0-100. */
  votingPowerPercentage: number;
  /** Staking-token (UM) balance for the current subaccount. */
  stakingTokens?: ValueView;
  /** Delegation-token balance for *this* validator (used for undelegate). */
  delegationTokens?: ValueView;
  stakingTokenMetadata?: Metadata;
  /** All delegations for the current subaccount (passed to submit). */
  allDelegations: ValueView[];
}

const VOTING_POWER_WARNING_THRESHOLD = 5;

export const StakingFormDialog = observer(
  ({
    validator,
    votingPowerPercentage,
    stakingTokens,
    delegationTokens,
    stakingTokenMetadata,
    allDelegations,
  }: StakingFormDialogProps) => {
    const action = stakingStore.action;
    // Only render the dialog when *this* validator is the active one.
    const targetIdentityKey = stakingStore.validatorInfo
      ? bech32mIdentityKey(getIdentityKeyFromValidatorInfo(stakingStore.validatorInfo))
      : undefined;
    const ownIdentityKey = bech32mIdentityKey(getIdentityKey(validator));
    const isActive = !!action && targetIdentityKey === ownIdentityKey;

    if (!isActive || !action) {
      return null;
    }

    const showVotingPowerWarning =
      action === 'delegate' && votingPowerPercentage > VOTING_POWER_WARNING_THRESHOLD;

    const balanceView = action === 'delegate' ? stakingTokens : delegationTokens;

    const setMax = () => {
      if (balanceView) {
        stakingStore.setAmount(getFormattedAmtFromValueView(balanceView));
      }
    };

    const handleSubmit = () => {
      if (!stakingTokenMetadata) {
        return;
      }
      void stakingStore.submit({
        stakingTokenMetadata,
        delegations: allDelegations,
      });
    };

    const title = action === 'delegate' ? 'Delegate' : 'Undelegate';
    const identityKey = ownIdentityKey;

    return (
      <Dialog isOpen onClose={stakingStore.closeDialog}>
        <Dialog.Content title={title}>
          <div className='flex flex-col gap-4 p-2'>
            <div className='flex flex-col gap-1'>
              <Text body>{validator.name || 'Unnamed validator'}</Text>
              <Text detailTechnical color='text.secondary'>
                {shorten(identityKey, 16)}
              </Text>
            </div>

            <Text small color='text.secondary'>
              Verify the identity key above is the one you expect — validator names can be spoofed.
            </Text>

            <div className='flex flex-col gap-2'>
              <Text small color='text.secondary'>
                Amount to {action}
              </Text>
              <TextInput
                value={stakingStore.amount}
                onChange={stakingStore.setAmount}
                placeholder='0'
                type='text'
              />
              {balanceView && (
                <button
                  type='button'
                  onClick={setMax}
                  className='self-end text-left transition-opacity hover:opacity-80'
                >
                  <div className='flex items-center gap-2'>
                    <Text detail color='text.secondary'>
                      Balance:
                    </Text>
                    <ValueViewComponent valueView={balanceView} priority='primary' />
                  </div>
                </button>
              )}
            </div>

            {stakingStore.lastError && (
              <div className='flex items-start gap-2 rounded-sm border border-destructive-light bg-destructive-light/5 p-3'>
                <CircleAlert size={20} className='shrink-0 text-destructive-light' />
                <Text small color='destructive.light'>
                  {stakingStore.lastError}
                </Text>
              </div>
            )}

            {showVotingPowerWarning ? (
              <div className='flex flex-col gap-3 rounded-sm border border-destructive-light bg-destructive-light/5 p-3'>
                <div className='flex items-start gap-2'>
                  <CircleAlert size={20} className='shrink-0 text-destructive-light' />
                  <Text small color='destructive.light'>
                    This validator already controls more than {VOTING_POWER_WARNING_THRESHOLD}% of
                    voting power. Consider a smaller validator to promote decentralization.
                  </Text>
                </div>
                <div className='flex gap-2'>
                  <Button
                    actionType='default'
                    priority='secondary'
                    onClick={stakingStore.closeDialog}
                  >
                    Choose another
                  </Button>
                  <Button
                    actionType='destructive'
                    priority='primary'
                    disabled={!stakingStore.amount || stakingStore.submitting}
                    onClick={handleSubmit}
                  >
                    Delegate anyway
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                actionType='accent'
                priority='primary'
                disabled={!stakingStore.amount || stakingStore.submitting}
                onClick={handleSubmit}
              >
                {stakingStore.submitting ? 'Submitting…' : title}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog>
    );
  },
);

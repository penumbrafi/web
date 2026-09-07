'use client';

import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getAmount } from '@penumbra-zone/getters/value-view';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { stakingStore } from '../model/staking-store';

export interface StakingActionsProps {
  validatorInfo: ValidatorInfo;
  /** Staking-token (UM) balance for the connected subaccount. */
  stakingTokens?: ValueView;
  /** Existing delegation tokens for *this* validator (if any). */
  delegationTokens?: ValueView;
  /** When true, render only the Delegate button (no existing delegation row). */
  delegateOnly?: boolean;
}

const isNonzero = (view?: ValueView) => !!view && joinLoHiAmount(getAmount(view)) > 0n;

export const StakingActions = observer(
  ({ validatorInfo, stakingTokens, delegationTokens, delegateOnly }: StakingActionsProps) => {
    const canDelegate = isNonzero(stakingTokens);
    const canUndelegate = isNonzero(delegationTokens);

    return (
      <div className='flex gap-2'>
        <Button
          actionType='accent'
          priority='primary'
          density='compact'
          disabled={!canDelegate || stakingStore.submitting}
          onClick={() => stakingStore.openDialog('delegate', validatorInfo)}
        >
          Delegate
        </Button>
        {!delegateOnly && (
          <Button
            actionType='default'
            priority='secondary'
            density='compact'
            disabled={!canUndelegate || stakingStore.submitting}
            onClick={() => stakingStore.openDialog('undelegate', validatorInfo)}
          >
            Undelegate
          </Button>
        )}
      </div>
    );
  },
);

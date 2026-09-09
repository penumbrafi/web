import { makeAutoObservable, runInAction } from 'mobx';
import BigNumber from 'bignumber.js';
import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { ValueView, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import {
  TransactionPlannerRequest,
  TransactionPlannerRequest_UndelegateClaim,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AppService, SctService, StakeService, ViewService } from '@penumbra-zone/protobuf';
import {
  BondingState,
  BondingState_BondingStateEnum,
} from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { getRateData } from '@penumbra-zone/getters/validator-info';
import { getBondingState } from '@penumbra-zone/getters/validator-status';
import {
  getAmount,
  getAssetIdFromValueView,
  getDisplayDenomExponentFromValueView,
  getDisplayDenomFromView,
  getValidatorIdentityKeyFromValueView,
} from '@penumbra-zone/getters/value-view';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { assetPatterns } from '@penumbra-zone/types/assets';
import { isDelegationTokenForValidator } from '@penumbra-zone/types/staking';
import { toBaseUnit } from '@penumbra-zone/types/lo-hi';
import { openToast } from '@penumbra-zone/ui/Toast';
import { connectionStore } from '@/shared/model/connection';
import { planBuildBroadcast } from '@/entities/transaction';
import { penumbra } from '@/shared/const/penumbra';

export type StakingAction = 'delegate' | 'undelegate';

/**
 * A delegate/undelegate the user has requested but that can't open the dialog
 * yet — usually because the wallet isn't connected, or the validator list
 * hasn't loaded. `useResolvePendingAction` watches for both and calls
 * `openDialog` as soon as the matching `ValidatorInfo` becomes available.
 * Cleared when the dialog opens or the user cancels.
 */
export interface PendingStakingAction {
  action: StakingAction;
  /** bech32m validator identity key. */
  identityKey: string;
}

/**
 * MobX store for the staking page.
 *
 * Mirrors the slice in `apps/minifront/src/state/staking/index.ts` but adapted
 * to veil's MobX + react-query pattern. React-query owns the read side
 * (`use-validator-infos`, `use-delegations`, `use-unbonding-tokens`); this store
 * owns the write side (form state + tx submission) so it's safe to instantiate
 * once at module scope.
 */
export class StakingStore {
  /** When defined, the delegate / undelegate dialog is open. */
  action?: StakingAction = undefined;
  /** The validator the user is acting on. */
  validatorInfo?: ValidatorInfo = undefined;
  /** Free-form amount string from the form input (display denom). */
  amount = '';
  /** True while a tx is in-flight (so we can disable buttons). */
  submitting = false;
  /**
   * A stake action the user asked for that we couldn't open yet (wallet not
   * connected, validator infos still loading, etc). Resolved by
   * `useResolvePendingAction` into a real `openDialog` call.
   */
  pending: PendingStakingAction | null = null;
  /** Latest queryClient invalidator passed in from the page. */
  private invalidate?: () => void;

  constructor() {
    makeAutoObservable(this);
  }

  setInvalidator(invalidate: () => void) {
    this.invalidate = invalidate;
  }

  openDialog = (action: StakingAction, validatorInfo: ValidatorInfo) => {
    this.action = action;
    this.validatorInfo = validatorInfo;
    this.amount = '';
    // A concrete open supersedes any pending request for the same flow.
    this.pending = null;
  };

  closeDialog = () => {
    this.action = undefined;
    this.validatorInfo = undefined;
    this.amount = '';
  };

  /**
   * Record that the user wants to act on this validator once the store can
   * actually open the dialog (validator infos loaded, wallet connected).
   */
  setPending = (pending: PendingStakingAction | null) => {
    this.pending = pending;
  };

  clearPending = () => {
    this.pending = null;
  };

  setAmount = (amount: string) => {
    this.amount = amount;
  };

  /**
   * Submit the currently-pending delegate/undelegate.
   *
   * Caller passes in the staking-token metadata (for delegate, to compute
   * base-unit amount) and the loaded delegations (for undelegate, to find
   * the matching delegation token).
   */
  submit = async ({
    stakingTokenMetadata,
    delegations,
  }: {
    stakingTokenMetadata: Metadata;
    delegations: ValueView[];
  }): Promise<void> => {
    if (!this.action || !this.validatorInfo || !this.amount) {
      return;
    }

    runInAction(() => {
      this.submitting = true;
    });

    try {
      const req =
        this.action === 'delegate'
          ? assembleDelegateRequest({
              account: connectionStore.subaccount,
              amount: this.amount,
              validatorInfo: this.validatorInfo,
              stakingTokenMetadata,
            })
          : assembleUndelegateRequest({
              account: connectionStore.subaccount,
              amount: this.amount,
              validatorInfo: this.validatorInfo,
              delegations,
            });

      // Reset dialog state before broadcasting so the user sees the toast
      // and can keep navigating while the tx confirms.
      const action = this.action;
      runInAction(() => {
        this.action = undefined;
        this.validatorInfo = undefined;
        this.amount = '';
      });

      await planBuildBroadcast(action, req);
      this.invalidate?.();
    } catch (e) {
      openToast({
        type: 'error',
        message: 'Staking transaction failed',
        description: String(e),
      });
    } finally {
      runInAction(() => {
        this.submitting = false;
      });
    }
  };

  /**
   * Build and broadcast undelegate-claim transactions for any unbonding tokens
   * that have finished their unbonding period.
   */
  claimUnbonded = async (unbondingTokens: ValueView[]): Promise<void> => {
    if (!unbondingTokens.length) {
      return;
    }
    runInAction(() => {
      this.submitting = true;
    });
    try {
      const req = await assembleUndelegateClaimRequest({
        account: connectionStore.subaccount,
        unbondingTokens,
      });
      await planBuildBroadcast('undelegateClaim', req);
      this.invalidate?.();
    } catch (e) {
      openToast({
        type: 'error',
        message: 'Failed to claim unbonded tokens',
        description: String(e),
      });
    } finally {
      runInAction(() => {
        this.submitting = false;
      });
    }
  };
}

export const stakingStore = new StakingStore();

const assembleDelegateRequest = ({
  account,
  amount,
  validatorInfo,
  stakingTokenMetadata,
}: {
  account: number;
  amount: string;
  validatorInfo: ValidatorInfo;
  stakingTokenMetadata: Metadata;
}): TransactionPlannerRequest =>
  new TransactionPlannerRequest({
    delegations: [
      {
        amount: toBaseUnit(BigNumber(amount), getDisplayDenomExponent(stakingTokenMetadata)),
        rateData: getRateData(validatorInfo),
      },
    ],
    source: { account },
  });

const assembleUndelegateRequest = ({
  account,
  amount,
  validatorInfo,
  delegations,
}: {
  account: number;
  amount: string;
  validatorInfo: ValidatorInfo;
  delegations: ValueView[];
}): TransactionPlannerRequest => {
  const delegation = delegations.find(d => isDelegationTokenForValidator(d, validatorInfo));
  if (!delegation) {
    throw new Error('No delegation tokens for this validator in the current subaccount');
  }
  return new TransactionPlannerRequest({
    undelegations: [
      {
        rateData: getRateData(validatorInfo),
        value: {
          amount: toBaseUnit(BigNumber(amount), getDisplayDenomExponentFromValueView(delegation)),
          assetId: getAssetIdFromValueView(delegation),
        },
      },
    ],
    source: { account },
  });
};

// --- undelegate-claim helpers (ported from minifront, simplified) -------------------

const parseUnbondingStartHeight = (unbondingValue: ValueView): bigint => {
  const denom = getDisplayDenomFromView(unbondingValue);
  const match = assetPatterns.unbondingToken.capture(denom);
  if (!match?.startAt) {
    throw new TypeError('Value is not an unbonding token', { cause: unbondingValue });
  }
  return BigInt(match.startAt);
};

const chooseUnbondingEndHeight = ({
  currentHeight,
  appUnbondingDelay,
  startHeight,
  validatorBondingState,
}: {
  currentHeight: bigint;
  appUnbondingDelay: bigint;
  startHeight: bigint;
  validatorBondingState: BondingState;
}) => {
  if (!validatorBondingState.state) {
    throw new ReferenceError('Validator bonding state must be available', {
      cause: validatorBondingState,
    });
  }
  const { state: validatorState, unbondsAtHeight: validatorHeight } = validatorBondingState;
  const appDelayHeight = startHeight + appUnbondingDelay;

  let endHeight: bigint;
  switch (validatorState) {
    case BondingState_BondingStateEnum.BONDED:
      endHeight = appDelayHeight;
      break;
    case BondingState_BondingStateEnum.UNBONDING:
      if (validatorHeight > startHeight) {
        endHeight = validatorHeight > appDelayHeight ? appDelayHeight : validatorHeight;
      } else {
        endHeight = currentHeight;
      }
      break;
    case BondingState_BondingStateEnum.UNBONDED:
      endHeight = currentHeight;
      break;
    default:
      endHeight = currentHeight;
  }

  return endHeight > currentHeight ? currentHeight : endHeight;
};

const assembleUndelegationClaim = async ({
  currentHeight,
  appUnbondingDelay,
  unbondingValue,
}: {
  currentHeight: bigint;
  appUnbondingDelay: bigint;
  unbondingValue: ValueView;
}): Promise<TransactionPlannerRequest_UndelegateClaim> => {
  const sctClient = penumbra.service(SctService);
  const stakeClient = penumbra.service(StakeService);

  const identityKey = getValidatorIdentityKeyFromValueView(unbondingValue);
  const { status: validatorStatus } = await stakeClient.validatorStatus({ identityKey });

  const startHeight = parseUnbondingStartHeight(unbondingValue);
  const { epoch: startEpoch } = await sctClient.epochByHeight({ height: startHeight });

  const endHeight = chooseUnbondingEndHeight({
    currentHeight,
    appUnbondingDelay,
    startHeight,
    validatorBondingState: getBondingState(validatorStatus),
  });
  const { epoch: endEpoch } = await sctClient.epochByHeight({ height: endHeight });

  if (!startEpoch || !endEpoch) {
    throw new Error('Failed to identify an unbonding epoch range', {
      cause: { startHeight, endHeight },
    });
  }

  const { penalty } = await stakeClient.validatorPenalty({
    identityKey,
    startEpochIndex: startEpoch.index,
    endEpochIndex: endEpoch.index,
  });

  if (!penalty) {
    throw new Error('No penalty for unbonding from validator', {
      cause: { unbondingValue, startEpoch, endEpoch, validatorIdentity: identityKey },
    });
  }

  return new TransactionPlannerRequest_UndelegateClaim({
    validatorIdentity: identityKey,
    unbondingStartHeight: startHeight,
    unbondingAmount: getAmount(unbondingValue),
    penalty,
  });
};

const assembleUndelegateClaimRequest = async ({
  account,
  unbondingTokens,
}: {
  account: number;
  unbondingTokens: ValueView[];
}): Promise<TransactionPlannerRequest> => {
  const appClient = penumbra.service(AppService);
  const viewClient = penumbra.service(ViewService);

  const { appParameters } = await appClient.appParameters({});
  if (!appParameters?.stakeParams?.unbondingDelay) {
    throw new ReferenceError('Unbonding delay must be available', {
      cause: appParameters?.stakeParams,
    });
  }
  const { unbondingDelay } = appParameters.stakeParams;

  const { fullSyncHeight } = await viewClient.status({});

  const undelegationClaims = await Promise.all(
    unbondingTokens.map(unbondingValue =>
      assembleUndelegationClaim({
        currentHeight: fullSyncHeight,
        appUnbondingDelay: unbondingDelay,
        unbondingValue,
      }),
    ),
  );

  return new TransactionPlannerRequest({
    undelegationClaims,
    source: { account },
  });
};

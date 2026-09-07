import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import {
  getDisplayDenomFromView,
  getValidatorInfoFromValueView,
} from '@penumbra-zone/getters/value-view';
import { assetPatterns } from '@penumbra-zone/types/assets';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';

/**
 * Bech32m identity key of a `ValidatorInfo`, or undefined if it cannot be
 * derived.
 *
 * The explorer identifies validators by their bech32m string (that is what the
 * GraphQL API returns as `id` and what appears in the URL), while the wallet
 * side works in `ValidatorInfo` protobufs. Every crossing between the two goes
 * through here, and every failure is non-throwing: a malformed key must not
 * take down a page whose validator data came from our own indexer and is
 * perfectly renderable without it.
 */
export const identityKeyOf = (validatorInfo: ValidatorInfo): string | undefined => {
  const key = getIdentityKeyFromValidatorInfo.optional(validatorInfo);
  if (!key) {
    return undefined;
  }
  try {
    return bech32mIdentityKey(key);
  } catch {
    return undefined;
  }
};

/** Find the `ValidatorInfo` for a bech32m identity key, if it has loaded. */
export const findValidatorInfo = (
  validatorInfos: ValidatorInfo[] | undefined,
  identityKey: string | undefined,
): ValidatorInfo | undefined => {
  if (!validatorInfos?.length || !identityKey) {
    return undefined;
  }
  return validatorInfos.find(info => identityKeyOf(info) === identityKey);
};

/**
 * Find the user's delegation token for a given validator, if they hold one.
 *
 * Undelegating is only possible against a delegation token you actually hold,
 * so this is what decides whether the Undelegate button is live.
 */
export const findDelegationToken = (
  delegations: ValueView[],
  identityKey: string | undefined,
): ValueView | undefined => {
  if (!identityKey) {
    return undefined;
  }
  return delegations.find(delegation => {
    try {
      return identityKeyOf(getValidatorInfoFromValueView(delegation)) === identityKey;
    } catch {
      return false;
    }
  });
};

/**
 * What the stake buttons on a validator detail page should do right now.
 *
 * Kept as a pure function over plain flags so the gating is testable without a
 * wallet, a provider, or a rendered tree — the states are easy to get subtly
 * wrong, and getting them wrong is what produced the original bug.
 */
export type StakeGate =
  /** Provider handshake still in flight — say so, don't offer a connect prompt. */
  | { kind: 'checking' }
  /** No wallet connected — offer to connect rather than erroring. */
  | { kind: 'connect' }
  /** Connected, but the validator's on-chain rate data has not arrived yet. */
  | { kind: 'loading' }
  /** Ready to act. `canUndelegate` is false when the user holds no delegation. */
  | { kind: 'ready'; canUndelegate: boolean };

export const stakeGate = ({
  connected,
  connectedLoading,
  hasValidatorInfo,
  hasDelegation,
}: {
  connected: boolean;
  connectedLoading: boolean;
  hasValidatorInfo: boolean;
  hasDelegation: boolean;
}): StakeGate => {
  if (connectedLoading) {
    return { kind: 'checking' };
  }
  if (!connected) {
    return { kind: 'connect' };
  }
  if (!hasValidatorInfo) {
    return { kind: 'loading' };
  }
  return { kind: 'ready', canUndelegate: hasDelegation };
};

/**
 * The user's claimable unbonding tokens that belong to one validator.
 *
 * An unbonding token's display denom encodes the validator it came from
 * (`unbonding_start_at_<height>_<identity key>`), which is the only way to
 * attribute a claim to a row. Anything unparseable is skipped rather than
 * thrown on — the row must still render.
 */
export const claimableForValidator = (
  claimable: ValueView[] | undefined,
  identityKey: string | undefined,
): ValueView[] => {
  if (!claimable?.length || !identityKey) {
    return [];
  }
  return claimable.filter(token => {
    const denom = getDisplayDenomFromView.optional(token);
    if (!denom) {
      return false;
    }
    return assetPatterns.unbondingToken.capture(denom)?.idKey === identityKey;
  });
};

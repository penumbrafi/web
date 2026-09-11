'use client';

import { useEffect } from 'react';
import { getIdentityKeyFromValidatorInfo } from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { stakingStore } from './staking-store';
import type { ValidatorInfosResult } from '../api/use-validator-infos';

/**
 * Watches `stakingStore.pending` and, once the wallet is connected and the
 * validator list has loaded, matches the requested identity key to a real
 * `ValidatorInfo` and opens the dialog.
 *
 * Safe to mount on any page that also mounts a data-loading `<StakingDialogHost>`
 * (or the staking page itself). Multiple mounts are fine — the effect
 * checks `stakingStore.pending` before acting, and `openDialog` clears it.
 */
export const useResolvePendingAction = ({
  connected,
  validatorInfosResult,
}: {
  connected: boolean;
  validatorInfosResult: ValidatorInfosResult | undefined;
}): void => {
  const pending = stakingStore.pending;

  useEffect(() => {
    if (!pending || !connected) {
      return;
    }
    const validatorInfos = validatorInfosResult?.validatorInfos;
    if (!validatorInfos?.length) {
      return;
    }
    const match = validatorInfos.find(vi => {
      const ik = getIdentityKeyFromValidatorInfo.optional(vi);
      if (!ik) {
        return false;
      }
      try {
        return bech32mIdentityKey(ik) === pending.identityKey;
      } catch {
        return false;
      }
    });
    if (match) {
      stakingStore.openDialog(pending.action, match);
    }
  }, [pending, connected, validatorInfosResult]);
};

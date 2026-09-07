'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ValidatorInfo } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { connectionStore } from '@/shared/model/connection';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';
import { findValidatorInfo } from './match-validator';

/**
 * Resolve a deferred "delegate to this validator" intent once a wallet is
 * available, and put the user back where they asked.
 *
 * Two ways an intent arrives:
 *
 *   - `?delegate=<bech32 identity>` in the URL, from a link elsewhere in the
 *     app (and from the `/portfolio/staking` redirect, which forwards it).
 *   - `stakingStore.pendingDelegate`, set when someone clicks Delegate on a
 *     row with no wallet connected. Without this the connect flow is a dead
 *     end: the user connects and is left staring at the table with no memory
 *     of what they were doing.
 *
 * Either way we wait for both the connection *and* the validator list — the
 * dialog needs the `ValidatorInfo` for its rate data — then open the dialog
 * and scroll the row into view. Fires at most once per mount so the user is
 * in control of the dialog afterwards.
 */
export const usePendingDelegate = (validatorInfos: ValidatorInfo[] | undefined): void => {
  const searchParams = useSearchParams();
  const queryTarget = searchParams?.get('delegate') ?? null;
  const handledRef = useRef(false);

  const { connected } = connectionStore;
  const storeTarget = stakingStore.pendingDelegate;
  const target = storeTarget ?? queryTarget;

  useEffect(() => {
    if (handledRef.current || !connected || !target || !validatorInfos?.length) {
      return;
    }

    const match = findValidatorInfo(validatorInfos, target);
    if (!match) {
      return;
    }

    handledRef.current = true;
    stakingStore.openDialog('delegate', match);
    stakingStore.setPendingDelegate(undefined);

    // Bring the row they clicked back into view behind the dialog, so
    // dismissing it leaves them where they started rather than at the top of
    // a 125-row table.
    if (typeof document !== 'undefined') {
      document
        .getElementById(`validator-${target}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [connected, target, validatorInfos]);
};

import { useQuery } from '@tanstack/react-query';
import { AppService, StakeService } from '@penumbra-zone/protobuf';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { BondingState_BondingStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import {
  getDisplayDenomFromView,
  getValidatorIdentityKeyFromValueView,
} from '@penumbra-zone/getters/value-view';
import { assetPatterns } from '@penumbra-zone/types/assets';
import { penumbra } from '@/shared/const/penumbra';
import { connectionStore } from '@/shared/model/connection';
import { useLatestBlockHeight } from '@/shared/api/compact-block';
import { useUnbondingTokens } from './use-unbonding-tokens';

// Mainnet's typical block time, for turning blocks left into a duration.
const BLOCK_MS = 5_470;

export interface UnbondingEntry {
  token: ValueView;
  validatorName: string;
  /** bech32 penumbravalid1… */
  validatorId: string;
  claimable: boolean;
  /** Height at which it becomes claimable; undefined until params load. */
  readyAtHeight?: number;
  /** Milliseconds until claimable (0 when claimable). */
  msLeft?: number;
}

const endHeightFor = (
  start: number,
  delay: number,
  current: number,
  state: BondingState_BondingStateEnum | undefined,
  unbondsAt: number,
): number => {
  const byDelay = start + delay;
  // Same rule the claim uses: a validator that is itself unbonding releases
  // its delegators when it finishes, if that comes first.
  if (state === BondingState_BondingStateEnum.UNBONDED) {
    return current;
  }
  if (state === BondingState_BondingStateEnum.UNBONDING) {
    return unbondsAt > start ? Math.min(unbondsAt, byDelay) : current;
  }
  return byDelay;
};

/** Human duration like "3d 4h" or "25m". */
export const formatDuration = (ms: number): string => {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) {
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Every unbonding token of the account, with its validator and when it
 * becomes claimable. The wallet's `claimable` flag is authoritative; the
 * height and duration are for display.
 */
export const useUnbondingSchedule = () => {
  const { data: tokens, isLoading } = useUnbondingTokens();
  const { data: currentHeight } = useLatestBlockHeight();
  const all = [...(tokens?.claimable.tokens ?? []), ...(tokens?.notYetClaimable.tokens ?? [])];
  const claimableSet = new Set(tokens?.claimable.tokens ?? []);

  const { data: delay } = useQuery({
    queryKey: ['stake-unbonding-delay'],
    enabled: connectionStore.connected,
    staleTime: Infinity,
    queryFn: async () => {
      const { appParameters } = await penumbra.service(AppService).appParameters({});
      return Number(appParameters?.stakeParams?.unbondingDelay ?? 0n);
    },
  });

  // One token per validator is enough to learn its identity key.
  const byValidator = new Map<string, ValueView>();
  for (const t of all) {
    const id = assetPatterns.unbondingToken.capture(getDisplayDenomFromView(t))?.idKey;
    if (id && !byValidator.has(id)) {
      byValidator.set(id, t);
    }
  }
  const ids = [...byValidator.keys()];

  const { data: validators } = useQuery({
    queryKey: ['unbonding-validators', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const stake = penumbra.service(StakeService);
      const out = new Map<
        string,
        { name?: string; state?: BondingState_BondingStateEnum; unbondsAt: number }
      >();
      await Promise.all(
        [...byValidator].map(async ([id, token]) => {
          const identityKey = getValidatorIdentityKeyFromValueView(token);
          const [info, status] = await Promise.all([
            stake.getValidatorInfo({ identityKey }).catch(() => undefined),
            stake.validatorStatus({ identityKey }).catch(() => undefined),
          ]);
          const bonding = status?.status?.bondingState;
          out.set(id, {
            // Empty means unknown, so the row falls back to the id.
            name: info?.validatorInfo?.validator?.name.trim()
              ? info.validatorInfo.validator.name
              : undefined,
            state: bonding?.state,
            unbondsAt: Number(bonding?.unbondsAtHeight ?? 0n),
          });
        }),
      );
      return out;
    },
  });

  const entries: UnbondingEntry[] = all.map(token => {
    const m = assetPatterns.unbondingToken.capture(getDisplayDenomFromView(token));
    const id = m?.idKey ?? '';
    const v = validators?.get(id);
    const claimable = claimableSet.has(token);
    let readyAtHeight: number | undefined;
    let msLeft: number | undefined;
    if (m?.startAt && delay && currentHeight !== undefined) {
      readyAtHeight = endHeightFor(
        Number(m.startAt),
        delay,
        currentHeight,
        v?.state,
        v?.unbondsAt ?? 0,
      );
      msLeft = claimable ? 0 : Math.max(0, readyAtHeight - currentHeight) * BLOCK_MS;
    }
    return {
      token,
      validatorId: id,
      validatorName: v?.name ?? `${id.slice(0, 18)}…`,
      claimable,
      readyAtHeight,
      msLeft,
    };
  });

  return { entries, isLoading };
};

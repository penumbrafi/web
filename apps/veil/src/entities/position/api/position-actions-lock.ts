import { observable, runInAction } from 'mobx';
import { PositionId } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';

export interface Lease {
  release: () => void;
}

/**
 * Watchdog for stuck wallet promises (user closes the extension popup,
 * extension crash, etc.) so those position ids don't stay wedged forever.
 * Not a normal-path timeout.
 *
 * MUST be at least as long as the wallet-side approval deadline:
 * `entities/transaction/api/build.ts` calls `authorizeAndBuild` with
 * `timeoutMs: 600_000` (10 min). Releasing the lease before the wallet
 * promise itself rejects would re-open exactly the same-nullifier race
 * the lease exists to prevent — a click landing between watchdog and
 * wallet-timeout would spend the LPNFT nullifier the still-pending tx
 * is already about to spend. 11 min = wallet deadline + 60s slack.
 */
const WATCHDOG_MS = 660_000;

const inFlight = observable.set<string>();

/**
 * MobX-observable read API for gating action buttons.
 *
 * In `observer()` components:
 *   inFlightPositions.has(bech32mPositionId(id))
 *   inFlightPositions.hasAny(ids.map(bech32mPositionId))
 */
export const inFlightPositions = {
  has(bech32: string): boolean {
    return inFlight.has(bech32);
  },
  hasAny(bech32s: string[]): boolean {
    // Iterate the observable's values so MobX tracks a read that changes
    // whenever the set membership changes — `.has` alone in a loop would
    // also work, but iterating once is cheaper and matches the tracking
    // guidance for ObservableSet.
    if (bech32s.length === 0) {
      return false;
    }
    const needle = new Set(bech32s);
    for (const held of inFlight.values()) {
      if (needle.has(held)) {
        return true;
      }
    }
    return false;
  },
};

/**
 * Names the specific bech32m ids from `positionIds` that are currently held.
 * Callers use this to produce a helpful toast on conflict.
 */
export function conflictingIds(positionIds: PositionId[]): string[] {
  const conflicts: string[] = [];
  for (const id of positionIds) {
    const b = bech32mPositionId(id);
    if (inFlight.has(b)) {
      conflicts.push(b);
    }
  }
  return conflicts;
}

/**
 * Acquires a lease over the bech32m form of every id in `positionIds`.
 * Returns `null` if ANY id is already in flight — never partially acquires.
 * Caller MUST call `release()` from a `finally` block.
 *
 * The returned `release` is idempotent (double-call is a no-op) and also
 * clears the watchdog timer.
 */
export function tryAcquire(positionIds: PositionId[]): Lease | null {
  const bech32s = positionIds.map(bech32mPositionId);

  for (const b of bech32s) {
    if (inFlight.has(b)) {
      return null;
    }
  }

  runInAction(() => {
    for (const b of bech32s) {
      inFlight.add(b);
    }
  });

  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    clearTimeout(watchdog);
    runInAction(() => {
      for (const b of bech32s) {
        inFlight.delete(b);
      }
    });
  };

  const watchdog = setTimeout(() => {
    if (released) {
      return;
    }
    console.warn(
      `[position-actions-lock] watchdog fired after ${WATCHDOG_MS}ms; ` +
        `force-releasing lease over ${bech32s.length} position(s): ${bech32s.join(', ')}`,
    );
    release();
  }, WATCHDOG_MS);

  return { release };
}

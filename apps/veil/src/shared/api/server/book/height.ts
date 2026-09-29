import { Client } from '@connectrpc/connect';
import { TendermintProxyService } from '@penumbra-zone/protobuf';
import { createClient } from '@/shared/utils/protos/utils.ts';

// Latest committed height, from pd's getStatus. Shared by every book route
// (/api/book and /api/book/v2) so they gate on ONE height poll per process
// rather than one each. Refreshed at most once a second per process,
// single-flighted, and NEVER on the request's critical path once a height is
// known: requests read the last known height and the refresh runs in the
// background. getStatus is cheap but not reliably fast (seconds when pd is
// busy), and awaiting it put that delay on every book request, cache hits
// included. A height up to ~1s old just means a new block's recompute starts
// up to ~1s later.
const HEIGHT_REFRESH_MS = 1_000;
// Beyond this, a remembered height is too old to gate on: treat it as
// unknown and fall back to the time window.
const HEIGHT_MAX_AGE_MS = 15_000;
interface HeightState {
  height?: bigint;
  /** When `height` was last confirmed by pd. */
  heightAt: number;
  /** When a refresh was last attempted (success or not). */
  triedAt: number;
  inflight?: Promise<bigint | undefined>;
}
const heightState: HeightState = { heightAt: 0, triedAt: 0 };
let cachedStatusClient: Client<typeof TendermintProxyService> | undefined;
const refreshHeight = (endpoint: string): Promise<bigint | undefined> => {
  if (!heightState.inflight) {
    heightState.triedAt = Date.now();
    cachedStatusClient ??= createClient(endpoint, TendermintProxyService);
    heightState.inflight = cachedStatusClient
      .getStatus({}, { timeoutMs: 2_000, signal: AbortSignal.timeout(2_000) })
      .then(res => {
        const h = res.syncInfo?.latestBlockHeight;
        if (h !== undefined) {
          heightState.height = h;
          heightState.heightAt = Date.now();
        }
        return h;
      })
      // Keep the last good height; HEIGHT_MAX_AGE_MS retires it if pd stays
      // unreachable.
      .catch(() => undefined)
      .finally(() => {
        heightState.inflight = undefined;
      });
  }
  return heightState.inflight;
};

export const getLatestHeight = async (endpoint: string): Promise<bigint | undefined> => {
  const now = Date.now();
  if (now - heightState.triedAt >= HEIGHT_REFRESH_MS) {
    const pending = refreshHeight(endpoint);
    if (heightState.height === undefined) {
      // Nothing known yet (cold start): this one request waits.
      return pending;
    }
  }
  return now - heightState.heightAt < HEIGHT_MAX_AGE_MS ? heightState.height : undefined;
};

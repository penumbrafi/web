import { isSunsettingAsset, type SunsettingAsset } from '@/shared/config/sunsetting-assets';
import type { PausedChannels } from '@/shared/api/ibc-bridge';

/**
 * IBC bridge-health policy for the Rotko-operated veil DEX.
 *
 * The source of truth is the chain, not a symbol list: every asset that arrived
 * over IBC carries the channel it came in on inside its base denom
 * (`transfer/channel-2/uusdc`), and a channel is only usable while its IBC
 * client is active. `/api/ibc-bridge` reports the channels whose client has
 * expired or been frozen; assets on those channels are marked "Bridge
 * closed".
 *
 * This is display-only. A paused channel means transfers over it no longer
 * settle, but the market itself keeps quoting and filling — nothing here
 * touches trading, routing, pair health, or amounts.
 */

/**
 * Copy shown on assets whose channel client is expired or frozen. It names the
 * bridge, not the asset: the asset still trades on Penumbra, only moving it in
 * or out is dead. "Closed", not "paused": nothing reopens it short of a
 * recovery on both chains.
 */
export const BRIDGE_PAUSED_LABEL = 'Bridge closed';
export const BRIDGE_PAUSED_TOOLTIP =
  'Still tradable on Penumbra. Moving this asset in or out over its original IBC channel no ' +
  "longer works: the channel's light client expired. Reopening it takes a network upgrade " +
  'on Penumbra and a governance vote on the other chain.';

/** `transfer/channel-2/uusdc` -> `channel-2`. Undefined for native denoms. */
const CHANNEL_TRACE = /^transfer\/channel-(\d+)\//;

/**
 * The channel an IBC asset arrived on, taken from its base denom. A denom lists
 * its hops outermost-first, so the first trace element is the most recent hop —
 * the channel (and therefore the client) whose death strands the asset.
 */
export const channelOfBaseDenom = (base?: string): string | undefined => {
  const match = base?.match(CHANNEL_TRACE);
  return match ? `channel-${match[1]}` : undefined;
};

/** True if this asset's settlement path is dead: its channel's client is expired or frozen. */
export const isAssetBridgePaused = (
  asset: SunsettingAsset | undefined,
  paused: PausedChannels,
): boolean => {
  const channel = channelOfBaseDenom(asset?.base);
  return !!channel && paused.has(channel);
};

/**
 * True if either side of a pair carries any warning at all — a paused channel
 * or a scheduled sunset. This is what the pair lists sort on: an unmarked pair
 * is one with a working path in and out, so those float to the top.
 */
export const isPairMarked = (
  a: SunsettingAsset | undefined,
  b: SunsettingAsset | undefined,
  paused: PausedChannels,
): boolean =>
  isAssetBridgePaused(a, paused) ||
  isAssetBridgePaused(b, paused) ||
  isSunsettingAsset(a) ||
  isSunsettingAsset(b);

'use client';

import cn from 'clsx';
import { isSunsettingAsset, SUNSETTING_LABEL, SUNSETTING_TOOLTIP } from '@/shared/config/sunsetting-assets';
import {
  BRIDGE_PAUSED_LABEL,
  BRIDGE_PAUSED_TOOLTIP,
  isAssetBridgePaused,
} from '@/shared/config/bridge-health';
import { usePausedChannels } from '@/shared/api/ibc-bridge';

interface BridgeAsset {
  base?: string;
  symbol?: string;
}

export interface BridgeStatusBadgeProps {
  /** Assets to check — the badge renders once if ANY of them is marked. */
  assets: (BridgeAsset | undefined)[];
  className?: string;
}

const CHIP = 'text-textXs rounded-xs px-1.5 py-0.5 whitespace-nowrap';

/**
 * Warning tag for an asset or pair whose settlement path is degraded. Renders
 * at most one chip, worst problem first:
 *
 *   1. "Bridge closed" — the asset arrived over an IBC channel whose client
 *      has expired or been frozen, so transfers no longer settle (chain state
 *      from /api/ibc-bridge, matched against the channel in the base denom).
 *   2. "Sunsetting" — Noble USDC, which Circle is winding down.
 *
 * Copy lives in shared/config so the wording and the dates sit next to the
 * policy they describe. Display-only: it renders copy and nothing more — it
 * never affects trading, routing, or amounts.
 *
 * Uses the native `title` tooltip rather than <Tooltip/>, whose trigger is a
 * <button>: this badge renders inside the pair <Link> on /explore and inside
 * the selector's buttons on /trade, where nesting a button would be invalid
 * markup and would swallow the click.
 */
export const BridgeStatusBadge = ({ assets, className }: BridgeStatusBadgeProps) => {
  const pausedChannels = usePausedChannels();

  if (assets.some(asset => isAssetBridgePaused(asset, pausedChannels))) {
    return (
      <span
        title={BRIDGE_PAUSED_TOOLTIP}
        className={cn(CHIP, 'bg-destructive-dark text-destructive-light', className)}
      >
        {BRIDGE_PAUSED_LABEL}
      </span>
    );
  }

  if (assets.some(isSunsettingAsset)) {
    return (
      <span
        title={SUNSETTING_TOOLTIP}
        className={cn(CHIP, 'bg-caution-dark text-caution-light', className)}
      >
        {SUNSETTING_LABEL}
      </span>
    );
  }

  return null;
};
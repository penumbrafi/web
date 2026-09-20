/**
 * Featured / healthy trading-pair policy for the Rotko-operated veil DEX.
 *
 * **The correct source of truth is the chain**: IBC channels report their own
 * state (OPEN/CLOSED) and their client's expiry, and any asset routed through
 * an OPEN + non-expired channel is by definition "healthy" — we should never
 * need a hand-maintained allowlist here. Wiring that up is the follow-up
 * (query ibc.core.channel.v1.Channels + ibc.core.client.v1.ClientStates at
 * mount, tag each registry asset by the channel it arrived on, derive
 * isPairHealthy from that).
 *
 * Until that lands the switch is off — every pair is treated as healthy, so
 * nothing is de-emphasized. The static allowlist below is retained only as a
 * fallback for the eventual "chain state unreachable" branch.
 */

/**
 * Master switch. `false` = every pair is healthy (correct default now that we
 * are no longer between IBC redeployments). Set to `true` only as an emergency
 * kill-switch and add the truly-live symbols to HEALTHY_SYMBOLS.
 */
export const BRIDGES_PAUSED = false;

/**
 * The pair a fresh visitor lands on at /trade (no last-viewed cookie).
 * UM/USDC is where the actual book depth lives today (Noble-bridged USDC,
 * live long before the Injective channel came up). New users see a
 * populated market instead of an empty one — the /deposit picker
 * separately guides them to bring USDC in via Injective going forward.
 */
export const DEFAULT_PAIR = { base: 'UM', quote: 'USDC' } as const;

/**
 * Assets whose settlement path is currently reliable. The registry
 * distinguishes bridge sources by symbol suffix (USDC = Noble path,
 * USDC.inj = Injective Peggy path), so a per-symbol allowlist is
 * effectively per-channel. Both stablecoin bridges are healthy; USDY is
 * retained for its own healthy pairs. A pair is "healthy" only if BOTH
 * of its assets are in this set. Symbols are compared upper-cased.
 */
export const HEALTHY_SYMBOLS: readonly string[] = ['UM', 'USDC', 'USDC.INJ', 'USDY'];

const norm = (s: string | undefined): string => (s ?? '').toUpperCase();

/** True if this pair should be shown at full prominence (not bridge-paused). */
export const isPairHealthy = (baseSymbol?: string, quoteSymbol?: string): boolean => {
  if (!BRIDGES_PAUSED) {
    return true;
  }
  return HEALTHY_SYMBOLS.includes(norm(baseSymbol)) && HEALTHY_SYMBOLS.includes(norm(quoteSymbol));
};

/** User-facing note shown on de-emphasized pairs. */
export const BRIDGE_PAUSED_LABEL = 'Bridging paused';
export const BRIDGE_PAUSED_TOOLTIP =
  'The IBC bridge for one of these assets is temporarily paused while we redeploy channels and clients. Trades may not settle until it is restored.';

/**
 * Legacy Noble-deprecation labels retained for the pair-card imports.
 * The right answer is again "read chain state" — a channel is either
 * live or it isn't. Until that check exists, these constants remain but
 * `isPairDeprecated` is a no-op so nothing ever gets tagged.
 */
export const NOBLE_DEPRECATION_LABEL = 'Deprecated bridge';
export const NOBLE_DEPRECATION_TOOLTIP =
  'This asset was originally bridged via Noble. Use the Injective path going forward — see the /deposit picker for the recommended flow.';

/**
 * Was: a hand-maintained "these symbols are deprecated" list.
 * Now: a no-op until we wire it to real chain state (open channel /
 * live client / non-zero recent throughput). Returning false everywhere
 * means the UI never de-emphasises a pair based on stale symbol lists.
 */
export const isPairDeprecated = (
  _baseSymbol?: string,
  _quoteSymbol?: string,
): boolean => false;

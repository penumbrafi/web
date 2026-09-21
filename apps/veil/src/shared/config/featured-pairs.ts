/**
 * Landing-pair policy for the Rotko-operated veil DEX.
 *
 * "Is this pair settleable" used to live here as a hand-maintained symbol
 * allowlist behind an off switch. It is derived from chain state now — see
 * `shared/config/bridge-health.ts` (paused channels, from /api/ibc-bridge) and
 * `shared/config/sunsetting-assets.ts` (scheduled sunsets) — so what remains
 * here is only the question of where a fresh visitor should land.
 */

/**
 * The pair a fresh visitor lands on at /trade (no last-viewed cookie).
 * UM/USDC is where the actual book depth lives today (Noble-bridged USDC,
 * live long before the Injective channel came up). New users see a
 * populated market instead of an empty one — the /deposit picker
 * separately guides them to bring USDC in via Injective going forward.
 *
 * It is a *marked* pair: Noble USDC carries the "Sunsetting" badge, and the
 * pair lists now sort unmarked markets above it. It stays the default because
 * a newcomer needs depth more than a clean badge — flip this to
 * `{ base: 'UM', quote: 'USDC.inj' }` if that trade-off ever inverts.
 */
export const DEFAULT_PAIR = { base: 'UM', quote: 'USDC' } as const;
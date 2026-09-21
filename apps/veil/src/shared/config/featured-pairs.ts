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
 * The pair a fresh visitor lands on at /trade (no last-viewed cookie),
 * and the destination of the "Start trading" / "Trade" cards on the
 * landing page. Kept in one place so a future flip needs one edit.
 *
 * UM/USDC.inj as of 2026-09: Circle is actively winding down Noble
 * USDC (see `sunsetting-assets`), so pointing newcomers there would
 * silently teach them to LP a sunsetting asset. UM/USDC.inj is the
 * Injective-bridged replacement and where new depth is expected to
 * consolidate; the /deposit picker already guides users to bring
 * USDC in via Injective. `/api/ibc-bridge` will mark the pair if
 * that channel ever goes dark.
 */
export const DEFAULT_PAIR = { base: 'UM', quote: 'USDC.inj' } as const;
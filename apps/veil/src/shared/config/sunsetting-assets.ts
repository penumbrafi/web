/**
 * Sunsetting-asset policy for the Rotko-operated veil DEX.
 *
 * Circle is discontinuing USDC and CCTP V1 on Noble, and Noble is not getting
 * CCTP V2: new minting to Noble stops 2026-10-13, CCTP V1 burn limits taper
 * from 2026-10-31 and exits may be limited after 2026-12-01 to chains that
 * still support V1 burns, and on 2027-01-12 the Noble USDC contract and the
 * CCTP routes pause outright — Circle snapshots balances that day and opens a
 * manual redemption portal on 2027-01-13. Injective USDC is the replacement
 * path.
 *
 * The wording is deliberately milder than "deprecated". The asset is not
 * dead yet and the market keeps trading; what a holder needs is the advice to
 * move off Noble while exits still work. The alt text carries the dates and the
 * recommendation; the chip stays one word.
 *
 * The Penumbra registry renames this asset from "USDC" to "USDC.n"; its base
 * denom — "transfer/channel-2/uusdc" — is unchanged by that rename, so the
 * denom is what we key on.
 *
 * Display-only, exactly like bridge-health: no effect on trading, routing, or
 * amounts. To retire another asset, add its base denom (preferred, stable
 * across symbol renames) or its upper-cased symbol below.
 */

/** Base denom of Noble USDC. Stable across the registry's USDC -> USDC.n rename. */
export const NOBLE_USDC_BASE_DENOM = 'transfer/channel-2/uusdc';

/** Circle's notice for this wind-down, linked from the badge's alt text. */
export const CIRCLE_NOBLE_NOTICE_URL =
  'https://www.circle.com/blog/circle-is-discontinuing-support-for-usdc-and-cctp-v1-on-noble';

/**
 * Canonical keys for sunsetting assets. The base denom is the reliable
 * identifier because it survives symbol renames; the symbol set is only a
 * fallback in case the registry ships the renamed "USDC.n" with a
 * different/absent base denom.
 *
 * Note: plain "USDC" is deliberately absent — the base denom already matches
 * today's Noble asset, and a bare-symbol match would wrongly tag a future,
 * non-Noble USDC (e.g. USDC.inj) that reuses the ticker.
 */
export const SUNSETTING_ASSET_BASE_DENOMS: readonly string[] = [NOBLE_USDC_BASE_DENOM];
export const SUNSETTING_ASSET_SYMBOLS: readonly string[] = ['USDC.N'];

/** Minimal shape we need off a Metadata to classify it. */
export interface SunsettingAsset {
  base?: string;
  symbol?: string;
}

/** True if this asset is being wound down and should carry the warning. */
export const isSunsettingAsset = (asset?: SunsettingAsset): boolean => {
  if (!asset) {
    return false;
  }
  if (asset.base && SUNSETTING_ASSET_BASE_DENOMS.includes(asset.base)) {
    return true;
  }
  return SUNSETTING_ASSET_SYMBOLS.includes((asset.symbol ?? '').toUpperCase());
};

/** User-facing chip label. */
export const SUNSETTING_LABEL = 'Sunsetting';

/** User-facing alt text: what is happening, when, and what to do about it. */
export const SUNSETTING_TOOLTIP =
  'Circle is discontinuing USDC and CCTP V1 on Noble. Minting stops Oct 13 2026, CCTP exits ' +
  'taper from Oct 31 and may be limited after Dec 1, and the Noble USDC contract pauses ' +
  'Jan 12 2027. Move funds off Noble before then — Injective USDC (USDC.inj) replaces it. ' +
  CIRCLE_NOBLE_NOTICE_URL;
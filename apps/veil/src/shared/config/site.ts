/**
 * What the site is, for metadata, link previews, the sitemap and llms.txt.
 * One place, so the wording stays the same everywhere it appears.
 */
export const SITE = {
  name: 'Penumbra',
  title: 'Penumbra: private trading and staking',
  description:
    'Trade, provide liquidity and stake on Penumbra, a shielded chain where balances, ' +
    'trades and strategies stay private. Shield assets in over IBC from Injective, ' +
    'Noble and more.',
} as const;

/**
 * Absolute origin for canonical URLs and link previews. From BASE_URL, set at
 * build time by CI (vars.BASE_URL) and at runtime by the host. Undefined when
 * unset (local dev), in which case Next falls back to localhost.
 */
export const siteOrigin = (): URL | undefined => {
  const raw = process.env['BASE_URL'];
  try {
    return raw ? new URL(raw) : undefined;
  } catch {
    return undefined;
  }
};

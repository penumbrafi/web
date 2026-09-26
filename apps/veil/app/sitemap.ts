import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/shared/config/site';
import { DEFAULT_PAIR } from '@/shared/config/featured-pairs';

// Read BASE_URL at request time, not the build's.
export const dynamic = 'force-dynamic';

// Public, stable pages worth indexing. Per-block pages (blocks, txs, LPs) are
// reachable from these and too many to list.
const PAGES: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: `/trade/${DEFAULT_PAIR.base}/${DEFAULT_PAIR.quote}`, priority: 0.9 },
  { path: '/portfolio/deposit', priority: 0.8 },
  { path: '/explore', priority: 0.7 },
  { path: '/explore/dex', priority: 0.6 },
  { path: '/explore/ibc', priority: 0.6 },
  { path: '/explore/validators', priority: 0.6 },
  { path: '/explore/governance', priority: 0.5 },
  { path: '/tournament', priority: 0.5 },
  { path: '/learn', priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (!origin) {
    return [];
  }
  const now = new Date();
  return PAGES.map(({ path, priority }) => ({
    url: new URL(path, origin).toString(),
    lastModified: now,
    priority,
  }));
}

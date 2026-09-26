import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { siteOrigin } from '@/shared/config/site';

// Per request: it depends on which host asked.
export const dynamic = 'force-dynamic';

/**
 * Index the canonical site only. The same build also answers on other hosts
 * (the dev slot, the second domain); those say Disallow, so search results
 * don't split across copies. Their pages already point their canonical at
 * the canonical host.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteOrigin();
  const host = (await headers()).get('host')?.split(':')[0];
  if (!origin || !host || host !== origin.hostname) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/pay'] },
    sitemap: new URL('/sitemap.xml', origin).toString(),
  };
}

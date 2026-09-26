import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/shared/config/site';

/**
 * Index the canonical site only: the dev slot and any other host serving
 * the same build say Disallow, so search results don't split across copies.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  if (!origin || process.env['VEIL_NOINDEX'] === '1') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/pay'] },
    sitemap: new URL('/sitemap.xml', origin).toString(),
  };
}

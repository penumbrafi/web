// ETag helpers for /api/book/v2. Pure, so the 304 rule is unit-testable
// without a Next request.

export interface BookEtagParts {
  pairKey: string;
  /** Height the book content last changed at (see `asOf` in index.ts). */
  asOf: string;
  step: number;
  levels: number;
  cursorBid?: number;
  cursorAsk?: number;
}

/** Strong ETag for one page of one pair's book. */
export const bookEtag = ({
  pairKey,
  asOf,
  step,
  levels,
  cursorBid,
  cursorAsk,
}: BookEtagParts): string =>
  // encodeURIComponent keeps a registry symbol with odd characters from
  // producing a header value that isn't plain ASCII / contains a quote.
  `"${encodeURIComponent(pairKey)}:${asOf}:${step}:${levels}:${cursorBid ?? ''}:${cursorAsk ?? ''}"`;

/**
 * RFC 9110 If-None-Match: `*`, or a comma-separated list of tags compared
 * weakly (a `W/` prefix on either side still matches). Proxies and browsers
 * may weaken a strong tag when they recompress, so an exact string compare
 * would silently never 304 behind nginx gzip.
 */
export const ifNoneMatchHits = (header: string | null, etag: string): boolean => {
  if (!header) {
    return false;
  }
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const target = strip(etag);
  return header.split(',').some(t => {
    const tag = t.trim();
    return tag === '*' || strip(tag) === target;
  });
};

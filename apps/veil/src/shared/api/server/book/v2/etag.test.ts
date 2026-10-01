import { describe, expect, it } from 'vitest';
import { bookEtag, ifNoneMatchHits } from './etag';

const tag = bookEtag({ pairKey: 'um|usdc', asOf: '123', step: 0.001, levels: 20 });

describe('bookEtag', () => {
  it('encodes every page parameter', () => {
    expect(tag).toBe('"um%7Cusdc:123:0.001:20::"');
    const paged = bookEtag({
      pairKey: 'um|usdc',
      asOf: '123',
      step: 0.001,
      levels: 20,
      cursorBid: 0.99,
    });
    expect(paged).not.toBe(tag);
  });
});

describe('ifNoneMatchHits', () => {
  it('matches exact, weak, listed and wildcard tags', () => {
    expect(ifNoneMatchHits(tag, tag)).toBe(true);
    expect(ifNoneMatchHits(`W/${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits(`"other", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits('*', tag)).toBe(true);
  });

  it('misses on absent or different tags', () => {
    expect(ifNoneMatchHits(null, tag)).toBe(false);
    expect(ifNoneMatchHits('', tag)).toBe(false);
    expect(ifNoneMatchHits('"um%7Cusdc:124:0.001:20::"', tag)).toBe(false);
  });
});

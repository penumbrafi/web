import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { routingProxy } from './proxy';

// Any origin will do: the proxy only reads the path, headers and cookies.
const ORIGIN = 'https://veil.test';

const req = (path: string, headers: Record<string, string> = {}, cookie?: string) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });

describe('routingProxy last-pair cookie', () => {
  it('records a real visit to a pair', () => {
    const res = routingProxy(req('/trade/UM/USDC.inj'));
    expect(res.cookies.get('veil_last_pair')?.value).toBe('UM/USDC.inj');
  });

  it('ignores prefetches, so a listed-but-unopened pair never becomes "last viewed"', () => {
    const prefetches: Record<string, string>[] = [
      { 'next-router-prefetch': '1' },
      { 'next-router-segment-prefetch': '/_tree' },
      { purpose: 'prefetch' },
      { 'sec-purpose': 'prefetch;prerender' },
    ];
    for (const headers of prefetches) {
      const res = routingProxy(req('/trade/ATOM.ch0/stATOM', headers));
      expect(res.cookies.get('veil_last_pair')).toBeUndefined();
    }
  });

  it('sends /trade to the last viewed pair', () => {
    const res = routingProxy(req('/trade', {}, 'veil_last_pair=INJ/USDC.inj'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/trade/INJ/USDC.inj`);
  });
});

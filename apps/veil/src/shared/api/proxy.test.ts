import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_PAIR_COOKIE } from '@/shared/config/featured-pairs';
import { routingProxy } from './proxy';

// Any origin will do: the proxy only reads the path and cookies.
const ORIGIN = 'https://veil.test';

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });

describe('routingProxy', () => {
  it('never writes the last-pair cookie (the trade page does, on mount)', () => {
    const res = routingProxy(req('/trade/ATOM.ch0/stATOM'));
    expect(res.cookies.get(LAST_PAIR_COOKIE)).toBeUndefined();
  });

  it('sends /trade to the last pair actually opened', () => {
    const res = routingProxy(req('/trade', `${LAST_PAIR_COOKIE}=INJ/USDC.inj`));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/trade/INJ/USDC.inj`);
  });

  it('ignores the old proxy-written cookie and lands on the default pair', () => {
    const res = routingProxy(req('/trade', 'veil_last_pair=ATOM.ch0/stATOM'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/trade/UM/USDC.inj`);
  });
});

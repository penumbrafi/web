import { describe, expect, it, vi } from 'vitest';
import { createOncePerBlockCache } from './once-per-block';

const signal = () => new AbortController().signal;

describe('createOncePerBlockCache', () => {
  it('computes a cold key once for concurrent requests', async () => {
    const gate = createOncePerBlockCache<number>('test');
    const compute = vi.fn(() => Promise.resolve(1));
    const [a, b] = await Promise.all([
      gate.get('k', 1n, compute, signal()),
      gate.get('k', 1n, compute, signal()),
    ]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('miss');
    expect(b.status).toBe('inflight');
  });

  it('serves the cached value for the rest of the block', async () => {
    const gate = createOncePerBlockCache<number>('test');
    const compute = vi.fn(() => Promise.resolve(1));
    await gate.get('k', 1n, compute, signal());
    const again = await gate.get('k', 1n, compute, signal());
    expect(again).toMatchObject({ status: 'cached', sameBlock: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('on a new block serves stale and refreshes once in the background', async () => {
    const gate = createOncePerBlockCache<number>('test');
    await gate.get('k', 1n, () => Promise.resolve(1), signal());
    let release: (v: number) => void = () => undefined;
    const compute = vi.fn(
      () =>
        new Promise<number>(r => {
          release = r;
        }),
    );
    const first = await gate.get('k', 2n, compute, signal());
    const second = await gate.get('k', 2n, compute, signal());
    expect(first.status).toBe('revalidate');
    expect(second.status).toBe('revalidate');
    expect(compute).toHaveBeenCalledTimes(1);
    release(2);
    await vi.waitFor(() => expect(gate.peek('k')?.data).toBe(2));
    expect(gate.peek('k')?.height).toBe(2n);
  });

  it('backs off after a failure and keeps serving the last good value', async () => {
    const gate = createOncePerBlockCache<number>('test');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await gate.get('k', 1n, () => Promise.resolve(1), signal());
    const failing = vi.fn(() => Promise.reject(new Error('pd down')));
    await gate.get('k', 2n, failing, signal());
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    // Let the rejection record the failed attempt.
    await new Promise(r => {
      setTimeout(r, 0);
    });
    const next = await gate.get('k', 3n, failing, signal());
    expect(next).toMatchObject({ status: 'cached', backingOff: true, sameBlock: false });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('serves empty when a cold compute fails', async () => {
    const gate = createOncePerBlockCache<number>('test');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await gate.get('k', 1n, () => Promise.reject(new Error('x')), signal());
    expect(res).toEqual({ status: 'empty', reason: 'MISS-FAIL' });
  });
});

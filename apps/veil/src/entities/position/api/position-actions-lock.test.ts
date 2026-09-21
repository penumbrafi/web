import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { PositionId } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { conflictingIds, inFlightPositions, tryAcquire } from './position-actions-lock';

// Build a distinguishable PositionId from a numeric seed. The bech32m
// encoder needs exactly 32 bytes; anything shorter throws, so pad.
const makeId = (seed: number): PositionId => {
  const inner = new Uint8Array(32);
  inner[0] = seed & 0xff;
  inner[1] = (seed >> 8) & 0xff;
  return new PositionId({ inner });
};

describe('position-actions-lock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Belt-and-suspenders: if a test forgot to release, drain the
    // watchdog while fake timers are still active.
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('grants a lease for a fresh position id', () => {
    const id = makeId(1);
    const lease = tryAcquire([id]);
    expect(lease).not.toBeNull();
    expect(inFlightPositions.has(bech32mPositionId(id))).toBe(true);
    lease?.release();
    expect(inFlightPositions.has(bech32mPositionId(id))).toBe(false);
  });

  it('rejects overlap and does not partially acquire', () => {
    const a = makeId(2);
    const b = makeId(3);
    const first = tryAcquire([a]);
    expect(first).not.toBeNull();

    // Overlap: {a, b} shares `a`. Must return null, and `b` must NOT
    // be inserted — otherwise a subsequent op on `b` alone would fail
    // to find a conflict and race the pending action on `a`.
    const overlap = tryAcquire([a, b]);
    expect(overlap).toBeNull();
    expect(inFlightPositions.has(bech32mPositionId(b))).toBe(false);

    first?.release();
  });

  it('parallelises disjoint sets', () => {
    const a = makeId(4);
    const b = makeId(5);
    const la = tryAcquire([a]);
    const lb = tryAcquire([b]);
    expect(la).not.toBeNull();
    expect(lb).not.toBeNull();
    expect(inFlightPositions.hasAny([bech32mPositionId(a), bech32mPositionId(b)])).toBe(true);
    la?.release();
    lb?.release();
  });

  it('release is idempotent', () => {
    const id = makeId(6);
    const lease = tryAcquire([id])!;
    lease.release();
    // Second call is a no-op — must not throw or leak.
    expect(() => lease.release()).not.toThrow();
    expect(inFlightPositions.has(bech32mPositionId(id))).toBe(false);
  });

  it('conflictingIds names the exact overlapping bech32m ids', () => {
    const a = makeId(7);
    const b = makeId(8);
    const c = makeId(9);
    const held = tryAcquire([a, b])!;
    const conflicts = conflictingIds([b, c]);
    expect(conflicts).toEqual([bech32mPositionId(b)]);
    held.release();
  });

  it('watchdog fires long after the wallet-approval deadline (>=10min+slack)', () => {
    const id = makeId(10);
    const lease = tryAcquire([id])!;
    // 10 min wallet deadline: watchdog must NOT have fired yet.
    vi.advanceTimersByTime(600_000);
    expect(inFlightPositions.has(bech32mPositionId(id))).toBe(true);
    // Just past the 11 min watchdog: MUST have force-released.
    vi.advanceTimersByTime(61_000);
    expect(inFlightPositions.has(bech32mPositionId(id))).toBe(false);
    // release() after watchdog is still a no-op.
    expect(() => lease.release()).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { isFundedPool } from './lqt-status';

describe('isFundedPool', () => {
  it('is inactive for the unfunded pool the chain reports today', () => {
    // lqt._epoch_info.available_rewards for epoch 443, after the tournament's
    // on-chain end block: the chain zeroes the pool every block.
    expect(isFundedPool('0')).toBe(false);
  });

  it('is active for a real funded pool', () => {
    // Epoch 225's accrued pool, the last full funded epoch.
    expect(isFundedPool('14571429324')).toBe(true);
  });

  it('is active from the first accrued base unit', () => {
    // One block after governance funds it, the pool is tiny but non-zero —
    // that must already count, or the page lags the chain by a block's worth
    // of rewards for no reason.
    expect(isFundedPool('1')).toBe(true);
  });

  it('handles NUMERIC formatting Postgres may return', () => {
    expect(isFundedPool('0.00')).toBe(false);
    expect(isFundedPool('421627.000000')).toBe(true);
    expect(isFundedPool('')).toBe(false);
  });

  it('does not lose precision above 2^53', () => {
    // A float comparison would still say true here, but the point is that no
    // conversion through Number happens at all.
    expect(isFundedPool('9007199254740993000000')).toBe(true);
  });
});

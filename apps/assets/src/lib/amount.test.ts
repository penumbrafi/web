import { describe, expect, it } from 'vitest';
import { scaleBaseUnits } from './amount';

describe('scaleBaseUnits', () => {
  it('scales UM base units (exponent 6)', () => {
    expect(scaleBaseUnits('123456789', 6)).toBe(123.456789);
    expect(scaleBaseUnits(1_000_000n, 6)).toBe(1);
  });

  it('is exact for 18-decimal amounts far beyond 2^53', () => {
    // 12,345,678.9 INJ in base units: 26 digits, far past Number's 2^53.
    const raw = '12345678900000000000000000';
    expect(scaleBaseUnits(raw, 18)).toBe(12_345_678.9);
    // The integer part is divided as a BigInt (one rounding, at the very
    // end) rather than Number(raw) / 1e18 (two roundings).
    const wide = '123456789012345678901234567890';
    expect(scaleBaseUnits(wide, 18)).toBe(
      Number(123456789012n) + Number(345678901234567890n) / 1e18,
    );
  });

  it('keeps sub-unit fractions', () => {
    expect(scaleBaseUnits('1', 18)).toBe(1e-18);
    expect(scaleBaseUnits('500000000000000000', 18)).toBe(0.5);
  });

  it('returns the raw amount for exponent 0 (assets not in the registry)', () => {
    expect(scaleBaseUnits('42', 0)).toBe(42);
  });

  it('handles zero', () => {
    expect(scaleBaseUnits('0', 18)).toBe(0);
  });
});

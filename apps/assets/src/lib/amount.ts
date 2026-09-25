/**
 * Scale a base-unit amount (which may exceed 2^53: 18-decimal assets such
 * as INJ, ETH and dydx routinely do) down to a display float. The integer
 * part is divided as a BigInt so it stays exact past 2^53; only the
 * fractional remainder is converted to a double, and that is < 10^exponent
 * by construction, so the result is correct to double precision.
 */
export const scaleBaseUnits = (raw: string | bigint, exponent: number): number => {
  const base = typeof raw === 'bigint' ? raw : BigInt(raw);
  if (exponent <= 0) {
    return Number(base);
  }
  const divisor = 10n ** BigInt(exponent);
  const whole = base / divisor;
  const frac = base % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
};

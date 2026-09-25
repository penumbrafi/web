/**
 * Attempt to parse a string into a number, returning `undefined` on failure.
 *
 * Accepts thousand-separators (comma or narrow non-breaking space) since the
 * LP inputs' regex allows commas and users pasting formatted amounts (e.g.
 * "1,000") should not silently turn into `Number("1,000") === NaN` (formerly
 * returned as `undefined`, downstream defaulted to zero — the LP form
 * silently zeroed the liquidity while the user saw their amount on screen).
 * Bare `.` prefix (e.g. ".5") stays valid; a trailing `.` (`"5."`) stays
 * valid too since Number accepts it.
 */
export const parseNumber = (x: string): number | undefined => {
  if (x.length <= 0) {
    return undefined;
  }
  // Strip common thousand-separators; leave the decimal `.` alone so
  // Number's own parse handles fractional values.
  const cleaned = x.replace(/[,  \s]/g, '');
  if (cleaned.length <= 0) {
    return undefined;
  }
  const out = Number(cleaned);
  return isNaN(out) ? undefined : out;
};

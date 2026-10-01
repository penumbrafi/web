import { pnum } from '@penumbra-zone/types/pnum';
import { DisplayPosition } from './types';

export interface PriceRange {
  min?: number;
  max?: number;
}

/**
 * A price-range input: empty means unbounded, anything that is not a
 * non-negative finite number is ignored rather than filtering everything out.
 */
export const parseRangeBound = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

export const isRangeActive = ({ min, max }: PriceRange): boolean =>
  min !== undefined || max !== undefined;

/**
 * The price a position is filtered by: its first order's effective price
 * (quote per base, in the row's orientation). Unlike `sortValues.effectivePrice`
 * this is kept for closed positions, so a range still matches them when the
 * withdraw half of a bulk removal runs.
 */
export const rangePriceOf = (position: DisplayPosition): number | undefined => {
  const order = position.orders[0];
  if (!order) {
    return undefined;
  }
  const price = pnum(order.effectivePrice).toNumber();
  return Number.isFinite(price) && price > 0 ? price : undefined;
};

export const inPriceRange = (position: DisplayPosition, range: PriceRange): boolean => {
  if (!isRangeActive(range)) {
    return true;
  }
  const price = rangePriceOf(position);
  if (price === undefined) {
    return false;
  }
  if (range.min !== undefined && price < range.min) {
    return false;
  }
  return range.max === undefined || price <= range.max;
};

import BigNumber from 'bignumber.js';
import { pnum } from '@penumbra-zone/types/pnum';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { PositionStats } from '@/shared/api/server/position/stats/types';
import { CalculatedAsset, PositionDerivedStats } from './types';

const MS_PER_DAY = 86_400_000;
// APR is unstable when the position is fresh: on a few days of history the
// 365/N factor turns one lucky arb into "867%". Under a week, show fees
// earned and no annualised figure.
export const MIN_AGE_DAYS_FOR_APR = 7;

// Project a (reserves1, reserves2) bundle onto the quote asset at the
// current mid. mid is asset1->asset2 price in display units (i.e. quote per
// unit base when quote is asset2).
const valueInQuote = (
  reserves1: BigNumber,
  reserves2: BigNumber,
  quoteIsAsset2: boolean,
  marketPrice: number,
): BigNumber => {
  if (quoteIsAsset2) {
    return reserves2.plus(reserves1.times(marketPrice));
  }
  if (marketPrice === 0) {
    return reserves1;
  }
  return reserves1.plus(reserves2.dividedBy(marketPrice));
};

export interface ComputeStatsArgs {
  raw: PositionStats;
  asset1: CalculatedAsset;
  asset2: CalculatedAsset;
  quoteAsset: CalculatedAsset;
  marketPrice: number | undefined;
}

export const computePositionStats = ({
  raw,
  asset1,
  asset2,
  quoteAsset,
  marketPrice,
}: ComputeStatsArgs): PositionDerivedStats | undefined => {
  const quoteIsAsset2 = quoteAsset.asset.penumbraAssetId?.equals(asset2.asset.penumbraAssetId);
  const quoteIsAsset1 = quoteAsset.asset.penumbraAssetId?.equals(asset1.asset.penumbraAssetId);
  if (!quoteIsAsset1 && !quoteIsAsset2) {
    return undefined;
  }

  const quoteExp = getDisplayDenomExponent.optional(quoteAsset.asset);
  if (quoteExp === undefined) {
    return undefined;
  }

  // pnum accepts Amount (not Value); take the amount field off each Value.
  const fees1Display = pnum(raw.fees1.amount, asset1.exponent).toBigNumber();
  const fees2Display = pnum(raw.fees2.amount, asset2.exponent).toBigNumber();
  const openR1Display = pnum(raw.openingReserves1.amount, asset1.exponent).toBigNumber();
  const openR2Display = pnum(raw.openingReserves2.amount, asset2.exponent).toBigNumber();
  const curR1Display = asset1.amount;
  const curR2Display = asset2.amount;

  const ageMs = Math.max(0, Date.now() - new Date(raw.openingTime).getTime());
  const ageDays = ageMs / MS_PER_DAY;

  const mid = marketPrice ?? 0;
  let feesQuoteBN: BigNumber;
  if (quoteIsAsset2) {
    feesQuoteBN = fees2Display.plus(fees1Display.times(mid));
  } else {
    feesQuoteBN = mid > 0 ? fees1Display.plus(fees2Display.dividedBy(mid)) : fees1Display;
  }
  const feesQuoteNum = Number.isFinite(feesQuoteBN.toNumber()) ? feesQuoteBN.toNumber() : 0;

  let pnlNumber = 0;
  let pnlValue: PositionDerivedStats['pnlValue'];
  if (mid > 0) {
    const lpNow = valueInQuote(curR1Display, curR2Display, !!quoteIsAsset2, mid);
    const hodl = valueInQuote(openR1Display, openR2Display, !!quoteIsAsset2, mid);
    const diff = lpNow.minus(hodl);
    pnlNumber = Number.isFinite(diff.toNumber()) ? diff.toNumber() : 0;
    pnlValue = pnum(pnlNumber, quoteExp).toValueView(quoteAsset.asset);
  }

  let aprPct: number | undefined;
  if (ageDays >= MIN_AGE_DAYS_FOR_APR && mid > 0 && feesQuoteNum > 0) {
    const capital = valueInQuote(openR1Display, openR2Display, !!quoteIsAsset2, mid);
    const capitalNum = capital.toNumber();
    if (capitalNum > 0 && Number.isFinite(capitalNum)) {
      const result = (feesQuoteNum / capitalNum) * (365 / ageDays) * 100;
      aprPct = Number.isFinite(result) ? result : undefined;
    }
  }

  const feesQuote = pnum(feesQuoteNum, quoteExp).toValueView(quoteAsset.asset);

  return {
    feesQuote,
    feesQuoteNumber: feesQuoteNum,
    aprPct,
    pnlValue,
    pnlNumber,
    ageDays,
  };
};

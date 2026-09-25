import { OhlcData, UTCTimestamp } from 'lightweight-charts';
import type { DbCandle } from '@/shared/api/server/candles/types.ts';
import { addDurationWindow, DurationWindow } from '@/shared/utils/duration.ts';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { calculateDisplayPrice } from '@/shared/utils/price-conversion.ts';

export interface CandleWithVolume {
  ohlc: OhlcData<UTCTimestamp>;
  volume: number;
  // Buy/sell split: buyVolume is base bought *with* quote (taker bid),
  // sellVolume is base sold *for* quote (taker ask). Both are reported in
  // display units of the quote asset so the two sides are comparable for
  // gradient/ratio rendering. Optional for back-compat with consumers that
  // only read total volume.
  buyVolume?: number;
  sellVolume?: number;
  // Subset of `volume` from direct (non-routed) swaps on this exact pair.
  directVolume?: number;
}

export const dbCandleToOhlc = (c: DbCandle, base: Metadata, quote: Metadata): CandleWithVolume => {
  // Single-direction shim kept for any caller that still does one query;
  // production /api/candles route uses combineDbCandles below.
  const quoteExponent = getDisplayDenomExponent(quote);
  const sellVolume = c.swap_volume / Math.pow(10, quoteExponent);
  const directVolume = c.direct_volume / Math.pow(10, quoteExponent);

  return {
    ohlc: {
      close: calculateDisplayPrice(c.close, base, quote),
      high: calculateDisplayPrice(c.high, base, quote),
      low: calculateDisplayPrice(c.low, base, quote),
      open: calculateDisplayPrice(c.open, base, quote),
      time: (c.start_time.getTime() / 1000) as UTCTimestamp,
    },
    volume: sellVolume,
    buyVolume: 0,
    sellVolume,
    directVolume,
  };
};

/**
 * Merge a forward (base→quote, taker-sell) and reverse (quote→base, taker-buy)
 * candle for the same time bucket into one CandleWithVolume with split volume.
 *
 * Either side may be undefined — pindexer only writes a row for a direction
 * that had at least one swap in the bucket.
 */
export const combineDbCandles = (
  forward: DbCandle | undefined,
  reverse: DbCandle | undefined,
  base: Metadata,
  quote: Metadata,
): CandleWithVolume => {
  if (!forward && !reverse) {
    throw new Error('combineDbCandles: both sides are undefined');
  }
  const baseExponent = getDisplayDenomExponent(base);
  const quoteExponent = getDisplayDenomExponent(quote);

  // sellVolume is already in quote atomic units (forward direction stores
  // swap_volume in asset_end == quote). Divide by quote exponent.
  const sellVolume = (forward?.swap_volume ?? 0) / Math.pow(10, quoteExponent);

  // Forward stores prices as quote/base in atomic units. calculateDisplayPrice
  // converts to display quote/base.
  const fwdClose = forward ? calculateDisplayPrice(forward.close, base, quote) : undefined;
  const revClose = reverse ? calculateDisplayPrice(reverse.close, quote, base) : undefined;

  // Reverse direction stores swap_volume in asset_end == base atomic units.
  // Convert base atomic → display base, then multiply by quote/base price to
  // express buy volume in display quote units. If forward isn't present in
  // this bucket, fall back to 1 / reverseClose for the price.
  const conversionPrice =
    fwdClose ?? (revClose !== undefined && revClose > 0 ? 1 / revClose : 0);
  const buyVolume =
    ((reverse?.swap_volume ?? 0) / Math.pow(10, baseExponent)) * conversionPrice;

  const directForward = (forward?.direct_volume ?? 0) / Math.pow(10, quoteExponent);
  const directReverse =
    ((reverse?.direct_volume ?? 0) / Math.pow(10, baseExponent)) * conversionPrice;
  const directVolume = directForward + directReverse;

  // OHLC: prefer forward direction (already in quote/base orientation).
  // If only reverse has data, invert reverse's prices.
  let open: number;
  let close: number;
  let high: number;
  let low: number;
  let timeMs: number;

  if (forward) {
    open = calculateDisplayPrice(forward.open, base, quote);
    close = calculateDisplayPrice(forward.close, base, quote);
    high = calculateDisplayPrice(forward.high, base, quote);
    low = calculateDisplayPrice(forward.low, base, quote);
    timeMs = forward.start_time.getTime();
    if (reverse) {
      // Widen high/low using inverted reverse extremes.
      const revHigh = calculateDisplayPrice(reverse.high, quote, base);
      const revLow = calculateDisplayPrice(reverse.low, quote, base);
      // 1/revLow is the highest forward-orientation price reverse-side saw.
      if (revLow > 0) {high = Math.max(high, 1 / revLow);}
      if (revHigh > 0) {low = Math.min(low, 1 / revHigh);}
    }
  } else if (reverse) {
    // reverse-only bucket
    const revOpen = calculateDisplayPrice(reverse.open, quote, base);
    const revClose2 = calculateDisplayPrice(reverse.close, quote, base);
    const revHigh = calculateDisplayPrice(reverse.high, quote, base);
    const revLow = calculateDisplayPrice(reverse.low, quote, base);
    open = revOpen > 0 ? 1 / revOpen : 0;
    close = revClose2 > 0 ? 1 / revClose2 : 0;
    high = revLow > 0 ? 1 / revLow : 0;
    low = revHigh > 0 ? 1 / revHigh : 0;
    timeMs = reverse.start_time.getTime();
  } else {
    // unreachable: the guard at the top throws when both are undefined
    throw new Error('combineDbCandles: both sides are undefined');
  }

  return {
    ohlc: {
      close,
      high,
      low,
      open,
      time: (timeMs / 1000) as UTCTimestamp,
    },
    volume: buyVolume + sellVolume,
    buyVolume,
    sellVolume,
    directVolume,
  };
};

// Upper bound on synthetic candles appended after the last real one. A 1m
// pair idle for a month would otherwise emit ~40k flat candles on every
// page-1 poll; the chart only needs the tail to read as "flat to now".
export const MAX_TAIL_FILL = 200;

const flatCandle = (time: UTCTimestamp, price: number): CandleWithVolume => ({
  ohlc: { time, open: price, close: price, low: price, high: price },
  volume: 0,
  buyVolume: 0,
  sellVolume: 0,
  directVolume: 0,
});

const nextBucket = (window: DurationWindow, time: UTCTimestamp): UTCTimestamp =>
  (addDurationWindow(window, new Date(time * 1000)).getTime() / 1000) as UTCTimestamp;

/**
 * Insert empty candles so that every timestamp as one candle.
 *
 * `fillTo` (unix seconds) extends the fill past the last real candle: flat
 * candles are appended for every bucket `<= fillTo` (capped at
 * `MAX_TAIL_FILL`). Page 1 passes `now` so a quiet pair reads as a flat
 * line up to the present; page N>1 passes the bucket just before page
 * N-1's oldest candle so the seam between pages has no visual gap. Gaps
 * were previously filled intra-page only, which under linear time left a
 * hole at every page boundary and a dangling tail on the newest page.
 */
export const insertEmptyCandles = (
  window: DurationWindow,
  data: CandleWithVolume[],
  fillTo?: UTCTimestamp,
): CandleWithVolume[] => {
  const out: CandleWithVolume[] = [];
  let i = 0;

  while (i < data.length) {
    const candle = data[i];
    if (!candle) {
      break;
    }

    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (!prev) {
        throw new Error('the impossible happened');
      }

      let nextTime = (addDurationWindow(window, new Date(prev.ohlc.time * 1000)).getTime() /
        1000) as UTCTimestamp;

      // Ensure we don't go backwards in time
      if (nextTime <= prev.ohlc.time) {
        i += 1;
        continue;
      }

      while (nextTime < candle.ohlc.time) {
        // Ensure we're not adding a candle before the previous one
        if (nextTime > prev.ohlc.time) {
          out.push({
            ohlc: {
              time: nextTime,
              open: prev.ohlc.close,
              close: prev.ohlc.close,
              low: prev.ohlc.close,
              high: prev.ohlc.close,
            },
            volume: 0,
            buyVolume: 0,
            sellVolume: 0,
            directVolume: 0,
          });
        }
        nextTime = (addDurationWindow(window, new Date(nextTime * 1000)).getTime() /
          1000) as UTCTimestamp;
      }
    }

    out.push(candle);
    i += 1;
  }

  if (fillTo !== undefined && out.length > 0) {
    const last = out[out.length - 1];
    if (last) {
      let nextTime = nextBucket(window, last.ohlc.time);
      let added = 0;
      while (nextTime <= fillTo && nextTime > last.ohlc.time && added < MAX_TAIL_FILL) {
        out.push(flatCandle(nextTime, last.ohlc.close));
        added += 1;
        const following = nextBucket(window, nextTime);
        if (following <= nextTime) {
          break;
        }
        nextTime = following;
      }
    }
  }

  return out;
};

import type { BookLevel } from './levels.ts';

export interface BookV2Asset {
  symbol: string;
  exponent: number;
}

/**
 * /api/book/v2 response: one page of each side, plain numbers only. Asset
 * metadata is sent once here instead of a ValueView per row.
 */
export interface BookV2Response {
  /** Chain height the book was read at, as a decimal string (null if unknown). */
  height: string | null;
  /** Raw (unbucketed) touch prices and their midpoint; null when a side is empty. */
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  /** Bucket width actually used (echo it back when paging). 0 = raw prices. */
  step: number;
  base: BookV2Asset;
  quote: BookV2Asset;
  /** Best-first: bids descend from the touch, asks ascend. */
  bids: BookLevel[];
  asks: BookLevel[];
  /** Price to pass as `cursorBid` / `cursorAsk` for the next page; absent at the end. */
  nextCursorBid?: number;
  nextCursorAsk?: number;
}

export type BookV2ApiResponse = BookV2Response | { error: string };

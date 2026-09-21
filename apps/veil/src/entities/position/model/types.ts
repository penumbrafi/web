import {
  BareTradingFunction,
  Position,
  PositionId,
  PositionState,
  PositionState_PositionStateEnum,
  TradingPair,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { Metadata, ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';

export interface DisplayPosition {
  id: PositionId;
  idString: string;
  position: Position;
  orders: {
    direction: string;
    amount: ValueView;
    basePrice: ValueView;
    effectivePrice: ValueView;
    baseAsset: CalculatedAsset;
    quoteAsset: CalculatedAsset;
  }[];
  fee: string;
  isWithdrawn: boolean;
  isOpened: boolean;
  isClosed: boolean;
  state: PositionState_PositionStateEnum;
  /** Fees+APR+PNL stats from pindexer; absent if not yet loaded or unavailable. */
  stats?: PositionDerivedStats;
  /** Quote-per-order-base mid, resolved per row (route mid on /trade, the
   *  row's own pair book elsewhere). Undefined when that pair has no book —
   *  cells fall back to Dash. */
  marketPrice?: number;
  sortValues: {
    type: string;
    tradeAmount: number;
    effectivePrice: number;
    basePrice: number;
    feeTier: number;
    positionId: string;
    feesQuote: number;
    aprPct: number;
    pnlVsHodl: number;
  };
}

export interface PositionDerivedStats {
  /** Cumulative fees, expressed as a ValueView in the order's quote asset. */
  feesQuote: ValueView;
  /** Numeric value of feesQuote in display units. */
  feesQuoteNumber: number;
  /** Annualised yield estimate (fees / capital * 365 / age_days), in percent.
   *  undefined when the position is younger than the noise threshold. */
  aprPct: number | undefined;
  /** PNL versus the "I just held opening reserves" benchmark, as a ValueView
   *  in quote units. Undefined if mid is missing. */
  pnlValue: ValueView | undefined;
  /** Numeric value of pnlValue. */
  pnlNumber: number;
  /** Position age, in days. */
  ageDays: number;
}

export interface CalculatedAsset {
  asset: Metadata;
  exponent: number;
  amount: BigNumber;
  price: BigNumber;
  effectivePrice: BigNumber;
  reserves: Amount;
}

// interface to avoid checking if the nested values exist on a Position
export interface ExecutedPosition {
  phi: {
    component: BareTradingFunction;
    pair: TradingPair;
  };
  nonce: Uint8Array;
  state: PositionState;
  reserves: {
    r1: Amount;
    r2: Amount;
  };
  closeOnFill: boolean;
}

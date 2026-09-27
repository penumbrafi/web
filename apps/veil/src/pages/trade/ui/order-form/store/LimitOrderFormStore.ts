import { PriceLinkedInputs } from './PriceLinkedInputs';
import {
  limitOrderPosition,
  LiquidityDistributionShape,
  PositionedLiquidity,
} from '@/shared/math/position';
import { reachPrice } from '@/shared/math/reach-price';
import { makeAutoObservable, observable, reaction } from 'mobx';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { parseNumber } from '@/shared/utils/num';
import type { Trace } from '@/shared/api/server/book/types';
import { AssetId, Value } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import BigNumber from 'bignumber.js';

export type Direction = 'buy' | 'sell';

/**
 * What the Limit tab does with the price you type.
 *
 * `rest` quotes a one-sided position at that price and waits — the only thing
 * on Penumbra that *guarantees* the price, because it simply does not trade at
 * a worse one. `take` fills against the book immediately, sized so the fill
 * stops at that price.
 */
export type LimitOrderMode = 'rest' | 'take';

export enum SellLimitOrderOptions {
  Market = 'Market',
  Plus2Percent = '+2%',
  Plus5Percent = '+5%',
  Plus10Percent = '+10%',
  Plus15Percent = '+15%',
}

export enum BuyLimitOrderOptions {
  Market = 'Market',
  Minus2Percent = '-2%',
  Minus5Percent = '-5%',
  Minus10Percent = '-10%',
  Minus15Percent = '-15%',
}

export const BuyLimitOrderMultipliers = {
  [BuyLimitOrderOptions.Market]: 1,
  [BuyLimitOrderOptions.Minus2Percent]: 0.98,
  [BuyLimitOrderOptions.Minus5Percent]: 0.95,
  [BuyLimitOrderOptions.Minus10Percent]: 0.9,
  [BuyLimitOrderOptions.Minus15Percent]: 0.85,
};

export const SellLimitOrderMultipliers = {
  [SellLimitOrderOptions.Market]: 1,
  [SellLimitOrderOptions.Plus2Percent]: 1.02,
  [SellLimitOrderOptions.Plus5Percent]: 1.05,
  [SellLimitOrderOptions.Plus10Percent]: 1.1,
  [SellLimitOrderOptions.Plus15Percent]: 1.15,
};

/** How take mode is getting on with sizing the order. */
export type TakeSizeStatus =
  /** No target price typed yet. */
  | 'idle'
  /** Take mode derives the side from the mid, and there is no mid. */
  | 'no-mid'
  /** Target typed, route book not in yet. */
  | 'loading'
  /** The book has nothing to take at or through that price, on that side. */
  | 'empty'
  /** The visible book runs out before the target. */
  | 'beyond'
  /** Sized down to the wallet balance — it cannot cover the full move. */
  | 'capped'
  /** The user edited an amount, so the sizer got out of the way. */
  | 'manual'
  /** Sized to reach the target. */
  | 'sized';

/** Take mode's state, in plain data, so `validateOrder` can judge it. */
export interface TakeLimitInfo {
  status: TakeSizeStatus;
  /** Zero when no price has been typed. */
  targetPrice: number;
  direction: Direction;
  baseSymbol: string;
  quoteSymbol: string;
  /** Worst level the walk touches, when it stopped short of the target. */
  worstPrice?: number;
  /** The asset the size was trimmed against, when it was trimmed. */
  cappedSymbol?: string;
}

/**
 * Truncate a display-unit amount at an asset's exponent, towards zero.
 *
 * The input side of a sized order must never round *up*: it was derived from
 * a balance, `validateOrder` compares display units, and one base unit of
 * float overshoot reads as "not enough" for an order the form itself sized.
 */
const floorToExponent = (amount: number, exponent: number): number => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return new BigNumber(amount)
    .shiftedBy(exponent)
    .integerValue(BigNumber.ROUND_FLOOR)
    .shiftedBy(-exponent)
    .toNumber();
};

export class LimitOrderFormStore {
  private _baseAsset?: AssetInfo;
  private _quoteAsset?: AssetInfo;
  private _input = new PriceLinkedInputs();
  direction: Direction = 'buy';
  marketPrice = 1.0;
  private _priceInput = '';
  private _priceInputOption: SellLimitOrderOptions | BuyLimitOrderOptions | undefined;
  _liquidityShape: LiquidityDistributionShape = LiquidityDistributionShape.LIMIT;

  private _mode: LimitOrderMode = 'rest';
  /** Set once a side is chosen explicitly in take mode: the target price
   *  stops re-deriving it. */
  private _directionPinned = false;
  /** Set once an amount is edited in take mode, so the sizer stops
   *  overwriting it. Cleared on every price edit. */
  private _userSized = false;
  private _buyRows?: Trace[];
  private _sellRows?: Trace[];
  private _sizeStatus: TakeSizeStatus = 'idle';
  private _sizeWorstPrice?: number;
  private _sizeCappedSymbol?: string;

  constructor() {
    // `ref` for the book rows: they arrive as two fresh arrays of up to 100
    // plain objects per block, and deep observability would proxy every one
    // of them for a value this store only ever reads whole.
    makeAutoObservable<this, '_buyRows' | '_sellRows'>(this, {
      _buyRows: observable.ref,
      _sellRows: observable.ref,
    });

    this._liquidityShape = LiquidityDistributionShape.LIMIT;

    reaction(() => [this.direction], this._resetInputs);
    // Take mode's entire input is the target price and the book: re-derive
    // the side and the size whenever any of them moves. React to the asset
    // objects too, since the balance they carry caps the size.
    reaction(
      () => [
        this._mode,
        this._priceInput,
        this.marketPrice,
        this._directionPinned,
        // Included so that taking over the amounts by hand immediately
        // downgrades the status to 'manual', instead of leaving the last
        // sized numbers on screen as if they still applied.
        this._userSized,
        this._buyRows,
        this._sellRows,
        this._baseAsset,
        this._quoteAsset,
      ],
      this._sizeTake,
    );
  }

  private _resetInputs = () => {
    // In take mode the target price *is* the input and the side follows it,
    // so a side change must clear neither — the sizer owns both fields.
    if (this._mode === 'take') {
      return;
    }
    this._input.setPair('', '');
    this._priceInput = '';
    this._userSized = false;
  };

  /**
   * Walk the book to the target and write the resulting amounts in.
   *
   * Two passes: one unbounded, to learn what the full move costs and whether
   * the book can reach it at all; then, if that exceeds the balance, the same
   * walk again with the balance as the budget — a target further than the
   * wallet can pay for becomes a max-sized order rather than an error.
   */
  private _sizeTake = () => {
    if (this._mode !== 'take') {
      this._clearTakeSize('idle');
      return;
    }
    const price = this.price;
    if (price === undefined || price <= 0) {
      this._clearTakeSize('idle');
      return;
    }
    if (this._userSized) {
      this._sizeStatus = 'manual';
      return;
    }
    if (!this._directionPinned) {
      const mid = this.marketPrice;
      if (!(mid > 0)) {
        this._clearTakeSize('no-mid');
        return;
      }
      // Aiming above the mid means buying into the asks, below it means
      // selling into the bids.
      this.direction = price > mid ? 'buy' : 'sell';
    }

    const buyRows = this._buyRows;
    const sellRows = this._sellRows;
    if (!buyRows || !sellRows) {
      this._clearTakeSize('loading');
      return;
    }

    const isBuy = this.direction === 'buy';
    const inputAsset = isBuy ? this._quoteAsset : this._baseAsset;

    const needed = reachPrice(this.direction, price, Infinity, buyRows, sellRows);
    if (needed.baseAmount <= 0) {
      this._clearTakeSize('empty');
      return;
    }

    const neededInput = isBuy ? needed.quoteAmount : needed.baseAmount;
    const balance = inputAsset?.balance;
    const capped = balance !== undefined && neededInput > balance;
    const fill = capped
      ? reachPrice(this.direction, price, balance, buyRows, sellRows)
      : needed;

    // The swap fixes its input exactly, so the spent side is the one that has
    // to be truncated; the received side is informational and can round.
    this._input.setPair(
      String(isBuy ? fill.baseAmount : floorToExponent(fill.baseAmount, this._baseAsset?.exponent ?? 6)),
      String(isBuy ? floorToExponent(fill.quoteAmount, this._quoteAsset?.exponent ?? 6) : fill.quoteAmount),
    );

    this._sizeWorstPrice = fill.worstPrice;
    this._sizeCappedSymbol = capped ? inputAsset?.symbol : undefined;
    if (capped) {
      this._sizeStatus = 'capped';
    } else {
      this._sizeStatus = fill.stoppedBy === 'book' ? 'beyond' : 'sized';
    }
  };

  private _clearTakeSize = (status: TakeSizeStatus) => {
    this._input.setPair('', '');
    this._sizeStatus = status;
    this._sizeWorstPrice = undefined;
    this._sizeCappedSymbol = undefined;
  };

  get mode(): LimitOrderMode {
    return this._mode;
  }

  /** How the sizing is going, for the form's own status line. */
  get takeSizeStatus(): TakeSizeStatus {
    return this._mode === 'take' ? this._sizeStatus : 'idle';
  }

  /** Deepest level the walk touched, when it stopped short of the target. */
  get takeWorstPrice(): number | undefined {
    return this._sizeWorstPrice;
  }

  setMode = (x: LimitOrderMode) => {
    if (this._mode === x) {
      return;
    }
    this._mode = x;
    this._directionPinned = false;
    this._userSized = false;
    this._priceInputOption = undefined;
    this._clearTakeSize('idle');
  };

  /** Feed in the route book the sizer walks. `undefined` until it resolves. */
  setBookRows = (buy: Trace[] | undefined, sell: Trace[] | undefined) => {
    if (buy === this._buyRows && sell === this._sellRows) {
      return;
    }
    this._buyRows = buy;
    this._sellRows = sell;
  };

  /**
   * Blank the target and the sized amounts once a take has been broadcast, so
   * a stray second click cannot rebuild the same swap — the take-mode
   * analogue of the Market form clearing its two amount fields.
   */
  clearTake = () => {
    this._userSized = false;
    this._priceInput = '';
    this._clearTakeSize('idle');
  };

  setDirection = (x: Direction) => {
    // In take mode the side normally follows the target price. Choosing one
    // pins it, which is how you ask to take at a price behind the touch and
    // get told there is nothing there.
    if (this._mode === 'take') {
      this._directionPinned = true;
    }
    this.direction = x;
  };

  get baseAsset(): undefined | AssetInfo {
    return this._baseAsset;
  }

  get quoteAsset(): undefined | AssetInfo {
    return this._quoteAsset;
  }

  get baseInput(): string {
    return this._input.inputA;
  }

  setBaseInput = (x: string) => {
    // An edit means the user has taken over sizing; the sizer keeps its hands
    // off until the target price or the mode changes.
    this._userSized = this._mode === 'take';
    this._input.inputA = x;
  };

  get quoteInput(): string {
    return this._input.inputB;
  }

  setQuoteInput = (x: string) => {
    this._userSized = this._mode === 'take';
    this._input.inputB = x;
  };

  get priceInput(): string {
    return this._priceInput;
  }

  get priceInputOption(): SellLimitOrderOptions | BuyLimitOrderOptions | undefined {
    return this._priceInputOption;
  }

  setPriceInput = (x: string, fromOption = false) => {
    this._priceInput = x;
    // A new target re-sizes, so any earlier manual edit no longer applies.
    this._userSized = false;
    const price = this.price;
    if (price !== undefined) {
      this._input.price = price;
    }
    if (!fromOption) {
      this._priceInputOption = undefined;
    }
  };

  setPriceInputOption = (option: SellLimitOrderOptions | BuyLimitOrderOptions) => {
    this._priceInputOption = option;
    const multiplier =
      this.direction === 'buy'
        ? BuyLimitOrderMultipliers[option as BuyLimitOrderOptions]
        : SellLimitOrderMultipliers[option as SellLimitOrderOptions];

    if (!multiplier) {
      return;
    }

    const price = multiplier * this.marketPrice;
    this.setPriceInput(price.toString(), true);
  };

  get price(): number | undefined {
    return parseNumber(this._priceInput);
  }

  /** Take mode's state as plain data, for the validator. */
  get takeLimit(): TakeLimitInfo | undefined {
    if (this._mode !== 'take') {
      return undefined;
    }
    return {
      status: this._sizeStatus,
      targetPrice: this.price ?? 0,
      direction: this.direction,
      baseSymbol: this._baseAsset?.symbol ?? 'the base asset',
      quoteSymbol: this._quoteAsset?.symbol ?? 'the quote asset',
      worstPrice: this._sizeWorstPrice,
      cappedSymbol: this._sizeCappedSymbol,
    };
  }

  /**
   * Same guard as `plan`, without building the position (which draws a
   * fresh nonce). Read this when you only need to know whether the form is
   * structurally complete.
   */
  get hasPlan(): boolean {
    if (this._mode === 'take') {
      return this.hasTakePlan;
    }
    const input =
      this.direction === 'buy' ? parseNumber(this.quoteInput) : parseNumber(this.baseInput);
    return !!input && !!this._baseAsset && !!this._quoteAsset && !!this.price;
  }

  /** Whether the take-mode swap is fully specified. Cheap: no protos built. */
  get hasTakePlan(): boolean {
    if (this._mode !== 'take' || !this._baseAsset || !this._quoteAsset || !this.price) {
      return false;
    }
    const input =
      this.direction === 'buy' ? parseNumber(this.quoteInput) : parseNumber(this.baseInput);
    return input !== undefined && input > 0;
  }

  get plan(): PositionedLiquidity | undefined {
    // Take mode submits a swap, not a position — see `takePlan`.
    if (this._mode === 'take') {
      return undefined;
    }
    const input =
      this.direction === 'buy' ? parseNumber(this.quoteInput) : parseNumber(this.baseInput);
    if (!input || !this._baseAsset || !this._quoteAsset || !this.price) {
      return undefined;
    }
    return limitOrderPosition({
      buy: this.direction,
      price: this.price,
      input,
      baseAsset: this._baseAsset,
      quoteAsset: this._quoteAsset,
      distributionShape: this._liquidityShape,
    });
  }

  /**
   * The swap a take-mode order submits: an exact input in the asset being
   * spent, targeting the other. Mirrors `MarketOrderFormStore.plan`.
   */
  get takePlan(): undefined | { targetAsset: AssetId; value: Value } {
    if (!this.hasTakePlan || !this._baseAsset || !this._quoteAsset) {
      return undefined;
    }
    const isBuy = this.direction === 'buy';
    const amount = parseNumber(isBuy ? this.quoteInput : this.baseInput);
    if (amount === undefined || amount <= 0) {
      return undefined;
    }
    return {
      targetAsset: (isBuy ? this._baseAsset : this._quoteAsset).id,
      value: (isBuy ? this._quoteAsset : this._baseAsset).value(amount),
    };
  }

  get balance(): string {
    if (this.direction === 'buy' && this._quoteAsset?.balance) {
      return this._quoteAsset.formatDisplayAmount(this._quoteAsset.balance);
    }
    if (this.direction === 'sell' && this._baseAsset?.balance) {
      return this._baseAsset.formatDisplayAmount(this._baseAsset.balance);
    }
    return '--';
  }

  setAssets(base: AssetInfo, quote: AssetInfo, resetInputs = false) {
    this._baseAsset = base;
    this._quoteAsset = quote;
    if (resetInputs) {
      this._input.setPair('', '');
      this._priceInput = '';
      this._priceInputOption = undefined;
      this._userSized = false;
      this._sizeStatus = 'idle';
      this._sizeWorstPrice = undefined;
      this._sizeCappedSymbol = undefined;
    }
  }
}

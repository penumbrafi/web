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

/**
 * How a limit order divides between taking and resting.
 *
 * Whatever the book offers at the limit price or better is swapped now; the
 * rest opens a one-sided position at the limit price. Resting the whole order
 * at a price through the market would let the protocol's end-of-block
 * arbitrage fill it against that better liquidity and keep the improvement,
 * so the crossing part is taken explicitly and the improvement stays with the
 * trader. All amounts are display units of the input asset (quote on a buy,
 * base on a sell) unless named otherwise.
 */
export interface LimitSplit {
  /** Swapped against the book now. Zero when nothing crosses. */
  takeInput: number;
  /** Base the take is expected to fill, informational. */
  takeBase: number;
  /** Quote the take is expected to pay or receive, informational. */
  takeQuote: number;
  /** Worst level the take touches; undefined when nothing is taken. */
  takeWorstPrice?: number;
  /** Rests as a one-sided position at the limit price. */
  restInput: number;
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

  private _buyRows?: Trace[];
  private _sellRows?: Trace[];

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
  }

  private _resetInputs = () => {
    this._input.setPair('', '');
    this._priceInput = '';
  };

  /** Feed in the route book the split walks. `undefined` until it resolves. */
  setBookRows = (buy: Trace[] | undefined, sell: Trace[] | undefined) => {
    if (buy === this._buyRows && sell === this._sellRows) {
      return;
    }
    this._buyRows = buy;
    this._sellRows = sell;
  };

  /** False until the route book has arrived; the split needs it. */
  get bookLoaded(): boolean {
    return this._buyRows !== undefined && this._sellRows !== undefined;
  }

  /**
   * Blank the price and amounts once an order containing a swap has been
   * broadcast, so a stray second click cannot rebuild the same swap — the
   * analogue of the Market form clearing its two amount fields.
   */
  clearAfterSwap = () => {
    this._input.setPair('', '');
    this._priceInput = '';
    this._priceInputOption = undefined;
  };

  setDirection = (x: Direction) => {
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
    this._input.inputA = x;
  };

  get quoteInput(): string {
    return this._input.inputB;
  }

  setQuoteInput = (x: string) => {
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

  /** The amount being spent: quote on a buy, base on a sell. */
  private get _orderInput(): number | undefined {
    const input =
      this.direction === 'buy' ? parseNumber(this.quoteInput) : parseNumber(this.baseInput);
    return input !== undefined && input > 0 ? input : undefined;
  }

  private get _inputAsset(): AssetInfo | undefined {
    return this.direction === 'buy' ? this._quoteAsset : this._baseAsset;
  }

  /**
   * Walk the book to the limit price with the order's own size as the budget:
   * that much fills now, the remainder rests at the limit price.
   */
  get split(): LimitSplit | undefined {
    const price = this.price;
    const input = this._orderInput;
    const inputAsset = this._inputAsset;
    const buyRows = this._buyRows;
    const sellRows = this._sellRows;
    if (!price || !input || !inputAsset || !this._baseAsset || !this._quoteAsset) {
      return undefined;
    }
    if (!buyRows || !sellRows) {
      return undefined;
    }
    const isBuy = this.direction === 'buy';
    const fill = reachPrice(this.direction, price, input, buyRows, sellRows);
    const filled = isBuy ? fill.quoteAmount : fill.baseAmount;
    // The swap fixes its input exactly, so it is truncated at the asset's
    // exponent and can never exceed what was typed.
    const takeInput = Math.min(input, floorToExponent(filled, inputAsset.exponent));
    const restInput = floorToExponent(input - takeInput, inputAsset.exponent);
    return {
      takeInput,
      takeBase: takeInput > 0 ? fill.baseAmount : 0,
      takeQuote: takeInput > 0 ? fill.quoteAmount : 0,
      takeWorstPrice: takeInput > 0 ? fill.worstPrice : undefined,
      restInput,
    };
  }

  /**
   * Whether the order is fully specified. Cheap next to `plan`, which draws a
   * nonce. Waits for the book: without it the split cannot know how much
   * crosses, and resting a crossing order would hand the improvement to the
   * protocol's arbitrage.
   */
  get hasPlan(): boolean {
    const split = this.split;
    return split !== undefined && (split.takeInput > 0 || split.restInput > 0);
  }

  /** The resting half: a one-sided position at the limit price, if any rests. */
  get plan(): PositionedLiquidity | undefined {
    const split = this.split;
    if (!split || split.restInput <= 0 || !this._baseAsset || !this._quoteAsset || !this.price) {
      return undefined;
    }
    return limitOrderPosition({
      buy: this.direction,
      price: this.price,
      input: split.restInput,
      baseAsset: this._baseAsset,
      quoteAsset: this._quoteAsset,
      distributionShape: this._liquidityShape,
    });
  }

  /**
   * The taking half: an exact-input swap of what crosses, targeting the other
   * asset. Mirrors `MarketOrderFormStore.plan`.
   */
  get takePlan(): undefined | { targetAsset: AssetId; value: Value } {
    const split = this.split;
    if (!split || split.takeInput <= 0 || !this._baseAsset || !this._quoteAsset) {
      return undefined;
    }
    const isBuy = this.direction === 'buy';
    return {
      targetAsset: (isBuy ? this._baseAsset : this._quoteAsset).id,
      value: (isBuy ? this._quoteAsset : this._baseAsset).value(split.takeInput),
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
    }
  }
}

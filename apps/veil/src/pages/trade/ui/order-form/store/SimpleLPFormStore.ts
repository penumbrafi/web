import { scaleLinear } from 'd3-scale';
import { openToast } from '@penumbra-zone/ui/Toast';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import {
  LiquidityDistributionShape,
  PositionedLiquidity,
  simpleLiquidityPositions,
} from '@/shared/math/position';
import { parseNumber } from '@/shared/utils/num';
import { Position } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { pnum } from '@penumbra-zone/types/pnum';
import { makeAutoObservable } from 'mobx';
import { round } from '@penumbra-zone/types/round';

const extractAmount = (positions: Position[], asset: AssetInfo): number => {
  let out = 0.0;
  for (const position of positions) {
    const asset1 = position.phi?.pair?.asset1;
    const asset2 = position.phi?.pair?.asset2;
    if (asset1?.equals(asset.id)) {
      out += pnum(position.reserves?.r1, asset.exponent).toNumber();
    }
    if (asset2?.equals(asset.id)) {
      out += pnum(position.reserves?.r2, asset.exponent).toNumber();
    }
  }
  return out;
};

const DEFAULT_POSITION_COUNT = 10;
export const DEFAULT_PRICE_SPREAD = 0.05;
export const STABLE_PRICE_SPREAD = 0.01;
export const DEFAULT_PRICE_RANGE = 0.3;
export const STABLE_PRICE_RANGE = 0.1;
const DEFAULT_FEE_TIER_PERCENT = 0.1;

/**
 * The fee a position charges takers, as a percentage.
 *
 * A position's fee is part of its trading function, not a protocol setting —
 * it is what the LP earns when someone trades against them. The form has
 * always had a `feeTierPercent`, defaulted to 0.1%, but never rendered it
 * anywhere, so LPs could neither see nor choose what they were charging.
 * These four are the conventional tiers: stable pairs at the bottom, volatile
 * and exotic pairs higher up, to compensate for inventory risk.
 */
export enum SimpleFeeTierOptions {
  Stable = '0.05%',
  Standard = '0.1%',
  Volatile = '0.3%',
  Exotic = '1%',
}

export const SIMPLE_FEE_TIER_PERCENTS: Record<SimpleFeeTierOptions, string> = {
  [SimpleFeeTierOptions.Stable]: '0.05',
  [SimpleFeeTierOptions.Standard]: '0.1',
  [SimpleFeeTierOptions.Volatile]: '0.3',
  [SimpleFeeTierOptions.Exotic]: '1',
};

export class SimpleLPFormStore {
  private _baseAsset?: AssetInfo;
  private _quoteAsset?: AssetInfo;
  private lastTouchedInput: 'base' | 'quote' | null = null;

  baseInput = '';
  quoteInput = '';
  upperPriceInput: number | null = null;
  lowerPriceInput: number | null = null;
  feeTierPercentInput = String(DEFAULT_FEE_TIER_PERCENT);
  marketPrice: number | null = null;
  positions = DEFAULT_POSITION_COUNT;
  liquidityShape: LiquidityDistributionShape = LiquidityDistributionShape.PYRAMID;

  constructor() {
    makeAutoObservable(this);
  }

  get baseAsset(): undefined | AssetInfo {
    return this._baseAsset;
  }

  get quoteAsset(): undefined | AssetInfo {
    return this._quoteAsset;
  }

  /**
   * Visualization & explanation of the scale and logic:
   * - If the price is lower than the market price, then offer quote
   * - If the price is higher than the market price, then offer base
   * - The scale is used to calculate the amount of opposite asset we want to offer
   *
   * Asset to Offer:         quote       base
   * Scale:           |---|----------|----------|---|
   * Domain (prices):   lower      market     upper
   * Range (amounts):    -10         0          10
   *            (or):     10         0         -10
   */
  updateOppositeInput = () => {
    if (
      this.marketPrice === null ||
      this.lowerPriceInput === null ||
      this.upperPriceInput === null
    ) {
      return;
    }

    if (this.lastTouchedInput === 'quote' && this.quoteInput === '') {
      this.baseInput = '';
    } else if (this.lastTouchedInput === 'quote' && this.quoteInput !== '') {
      const scale = scaleLinear()
        .domain([this.lowerPriceInput, this.marketPrice])
        // eslint-disable-next-line @typescript-eslint/no-unsafe-unary-minus -- explicitly set a negative value to get a positive output
        .range([-this.quoteInput, 0]);

      // extrapolate the value based on the inputs above
      const valueInQuote = scale(this.upperPriceInput);

      // convert the value to the equivalent base asset amount
      this.baseInput = round({
        value: String(Math.max(0, valueInQuote / this.marketPrice)) || '',
        decimals: this.baseAsset?.exponent ?? 6,
        exponentialNotation: false,
      });
    }

    if (this.lastTouchedInput === 'base' && this.baseInput === '') {
      this.quoteInput = '';
    } else if (this.lastTouchedInput === 'base' && this.baseInput !== '') {
      const scale = scaleLinear()
        .domain([this.marketPrice, this.upperPriceInput])
        // eslint-disable-next-line @typescript-eslint/no-unsafe-unary-minus -- explicitly set a negative value to get a positive output
        .range([0, -this.baseInput]);

      // extrapolate the value based on the inputs above
      const valueInBase = scale(this.lowerPriceInput);

      // convert the value to the equivalent quote asset amount
      this.quoteInput = round({
        value: String(Math.max(0, valueInBase * this.marketPrice)) || '',
        decimals: this.quoteAsset?.exponent ?? 6,
        exponentialNotation: false,
      });
    }
  };

  setBaseInput = (x: string) => {
    this.baseInput = x.replace(/[^0-9.,]/g, '');
    this.lastTouchedInput = 'base';

    this.updateOppositeInput();
  };

  setQuoteInput = (x: string) => {
    this.quoteInput = x.replace(/[^0-9.,]/g, '');
    this.lastTouchedInput = 'quote';

    this.updateOppositeInput();
  };

  get lowerPrice(): number | null {
    return this.lowerPriceInput;
  }

  setLowerPriceInput = (x: number) => {
    this.lowerPriceInput = x;

    if (
      this.lastTouchedInput === 'quote' &&
      this.marketPrice &&
      this.lowerPriceInput > this.marketPrice
    ) {
      if (this.quoteInput !== '') {
        openToast({
          type: 'warning',
          message: `Range is entirely above mid — asks only.`,
          description: `${this._quoteAsset?.symbol} can only be quoted below the mid price, so that side has been cleared. Enter a ${this._baseAsset?.symbol} amount to quote asks; it will start earning once the market trades up into your range.`,
        });
      }

      this.quoteInput = '';
    }

    this.updateOppositeInput();
  };

  get upperPrice(): number | null {
    return this.upperPriceInput;
  }

  setUpperPriceInput = (x: number) => {
    this.upperPriceInput = x;

    if (
      this.lastTouchedInput === 'base' &&
      this.marketPrice &&
      this.upperPriceInput < this.marketPrice
    ) {
      if (this.baseInput !== '') {
        openToast({
          type: 'warning',
          message: `Range is entirely below mid — bids only.`,
          description: `${this._baseAsset?.symbol} can only be quoted above the mid price, so that side has been cleared. Enter a ${this._quoteAsset?.symbol} amount to quote bids; it will start earning once the market trades down into your range.`,
        });
      }

      this.baseInput = '';
    }

    this.updateOppositeInput();
  };

  // Treat fees that don't parse as 0
  get feeTierPercent(): number {
    return Math.max(0, Math.min(parseNumber(this.feeTierPercentInput) ?? 0, 50));
  }

  feeTierOption: SimpleFeeTierOptions | undefined = SimpleFeeTierOptions.Standard;

  setFeeTierPercentInput = (x: string) => {
    this.feeTierPercentInput = x;
    this.feeTierOption = Object.values(SimpleFeeTierOptions).find(
      option => SIMPLE_FEE_TIER_PERCENTS[option] === x,
    );
  };

  setFeeTierOption = (option: SimpleFeeTierOptions) => {
    this.setFeeTierPercentInput(SIMPLE_FEE_TIER_PERCENTS[option]);
  };

  /** The base amount actually being provisioned, treating a blank field as zero. */
  get baseLiquidity(): number {
    return parseNumber(this.baseInput) ?? 0;
  }

  /** The quote amount actually being provisioned, treating a blank field as zero. */
  get quoteLiquidity(): number {
    return parseNumber(this.quoteInput) ?? 0;
  }

  /** True when only one of the two assets is being provisioned. */
  get isOneSided(): boolean {
    return this.baseLiquidity > 0 !== this.quoteLiquidity > 0;
  }

  get plan(): PositionedLiquidity[] | undefined {
    if (
      !this._baseAsset ||
      !this._quoteAsset ||
      this.upperPrice === null ||
      this.lowerPrice === null ||
      this.marketPrice === null
    ) {
      return undefined;
    }

    // A one-sided LP — all bids or all asks — is a legitimate and common
    // strategy, and is what a range that sits entirely to one side of mid
    // *means*. Requiring both fields to be non-empty made it unreachable:
    // dragging the range off mid clears the opposite input (see
    // set{Lower,Upper}PriceInput), which then left `plan` undefined and the
    // submit button permanently, silently dead. See penumbra-zone/web#2551.
    // Only a genuinely empty form has nothing to plan.
    if (this.baseLiquidity <= 0 && this.quoteLiquidity <= 0) {
      return undefined;
    }

    return simpleLiquidityPositions({
      baseAsset: this._baseAsset,
      quoteAsset: this._quoteAsset,
      baseLiquidity: this.baseLiquidity,
      quoteLiquidity: this.quoteLiquidity,
      upperPrice: this.upperPrice,
      lowerPrice: this.lowerPrice,
      marketPrice: this.marketPrice,
      feeBps: this.feeTierPercent * 100,
      positions: this.positions,
      distributionShape: this.liquidityShape,
    });
  }

  get baseAssetAmount(): string | undefined {
    const baseAsset = this._baseAsset;
    const plan = this.plan;
    if (!plan || !baseAsset) {
      return undefined;
    }
    const positions: Position[] = plan.map(p => p.position);

    return baseAsset.formatDisplayAmount(extractAmount(positions, baseAsset));
  }

  get quoteAssetAmount(): string | undefined {
    const quoteAsset = this._quoteAsset;
    const plan = this.plan;
    if (!plan || !quoteAsset) {
      return undefined;
    }
    const positions: Position[] = plan.map(p => p.position);

    return quoteAsset.formatDisplayAmount(extractAmount(positions, quoteAsset));
  }

  setAssets(base: AssetInfo, quote: AssetInfo, resetInputs = false) {
    this._baseAsset = base;
    this._quoteAsset = quote;
    if (resetInputs) {
      this.upperPriceInput = null;
      this.lowerPriceInput = null;
      this.baseInput = '';
      this.quoteInput = '';
    }
  }

  setLiquidityShape = (shape: LiquidityDistributionShape) => {
    this.liquidityShape = shape;
  };
}

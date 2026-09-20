import Image from 'next/image';
import cn from 'clsx';
import { observer } from 'mobx-react-lite';
import {
  InfoIcon,
  ZoomIn,
  ZoomOut,
  SlidersHorizontal,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { OrderFormStore } from './store/OrderFormStore';
import { DEFAULT_PRICE_RANGE, DEFAULT_PRICE_SPREAD } from './store/LPFormStore';
import { PriceSlider, roundToDecimals } from './price-slider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@penumbra-zone/ui/Icon';
import { Density } from '@penumbra-zone/ui/Density';
import { useIsLqtEligible, LQT_ENABLED } from '@/shared/utils/is-lqt-eligible';
import { LiquidityDistributionShape } from '@/shared/math/position';
import { ConfirmInfoRow, ConfirmOrderModal, ConfirmWarning } from './confirm-order-modal';
import { FormIssueNotice } from './form-issue';
import { useReferencePrice } from '@/pages/trade/model/useReferencePrice';
import type { LPFormStore } from './store/LPFormStore';

/**
 * Tiny hint-chip under the reference-price input: "Suggested: 1.00 (peg)"
 * or "Suggested: 43,120 USDC.inj (BTC/USDC.inj via CoinGecko)". Click to
 * apply. Hidden when we have no intel — user just sees the input's
 * placeholder ("live mid") in that case.
 *
 * Rendered as its own observer component so the price fetch's setState
 * doesn't re-render the whole LP form on every 60s cache refresh.
 */
const SuggestedRefPrice = observer(
  ({
    store,
    decimals,
    quoteSym,
  }: {
    store: LPFormStore;
    decimals: number;
    quoteSym: string;
  }) => {
    const baseSym = store.baseAsset?.symbol;
    const quoteSymForHook = store.quoteAsset?.symbol;
    const { price, source } = useReferencePrice(baseSym, quoteSymForHook);

    // Auto-apply the suggestion the FIRST time it becomes available for a
    // pair, but only for FIXED sources (stablecoin pegs) — those are
    // unambiguous (1.0 for USDC/USDC.inj etc.) and users otherwise had to
    // notice the "Suggested" chip, understand what it meant, and click.
    // On a peg pair the "obvious right answer" is 1.0; make that the
    // default so the LP form Just Works.
    //
    // We deliberately do NOT auto-apply CoinGecko-sourced prices — those
    // move, and a stale/lagging value silently anchoring a user's ladder
    // to yesterday's BTC price would be worse than making them click.
    // CoinGecko stays a "Use" chip.
    //
    // Only auto-apply when the input is EMPTY (user hasn't typed anything
    // for this pair) — an explicit user override always wins.
    const autoAppliedForPairRef = useRef<string | null>(null);
    const currentPairKey = baseSym && quoteSymForHook ? `${baseSym}|${quoteSymForHook}` : null;
    useEffect(() => {
      if (!currentPairKey || price === undefined || source !== 'fixed') return;
      if (autoAppliedForPairRef.current === currentPairKey) return;
      if (store.userReferencePriceInput.trim().length > 0) return;
      const formatted = roundToDecimals(price, decimals);
      store.setUserReferencePriceInput(String(formatted));
      autoAppliedForPairRef.current = currentPairKey;
    }, [currentPairKey, price, source, store, decimals]);

    if (price === undefined) return null;
    const label = source === 'fixed' ? 'stablecoin peg' : source === 'coingecko' ? 'CoinGecko' : 'CoinGecko / peg';
    const current = store.userReferencePrice;
    const already = current !== null && Math.abs(current - price) / price < 0.001;
    const formatted = roundToDecimals(price, decimals);
    return (
      <div className='mt-1 flex items-center gap-1 text-xs text-text-muted'>
        <span>
          {already
            ? `Applied: ${formatted} ${quoteSym} (${label})`
            : `Suggested: ${formatted} ${quoteSym} (${label})`}
        </span>
        {!already && (
          <button
            type='button'
            onClick={() => store.setUserReferencePriceInput(String(formatted))}
            className='ml-auto rounded-sm border border-other-tonal-stroke px-1.5 py-0.5 text-text-secondary hover:border-orange-500 hover:text-text-primary'
          >
            Use
          </button>
        )}
      </div>
    );
  },
);

/**
 * The reference-price text input plus its suggestion chip. Its own
 * observer so the mobx reads of `userReferencePriceInput` / `marketPrice`
 * subscribe HERE, not on the whole LPOrderForm — a keystroke that doesn't
 * change the parsed value (e.g. "1" → "1.") then re-renders only this
 * small component rather than the entire form + confirm modal.
 *
 * Note: a keystroke that DOES change the parsed value moves
 * `effectiveMarketPrice`, which the parent legitimately observes (it has
 * to — the plan, confirm rows and overlay all rebuild against it). This
 * split trims the redundant re-renders, not the necessary ones.
 */
const ReferencePriceInput = observer(
  ({
    store,
    decimals,
    quoteSym,
  }: {
    store: LPFormStore;
    decimals: number;
    quoteSym: string;
  }) => (
    <>
      <input
        type='text'
        inputMode='decimal'
        value={store.userReferencePriceInput}
        onChange={e => store.setUserReferencePriceInput(e.target.value)}
        placeholder={
          store.marketPrice
            ? `${roundToDecimals(store.marketPrice, decimals)} (live mid)`
            : 'e.g. 1'
        }
        className='w-full rounded-sm border border-other-tonal-stroke bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-orange-500 focus:outline-none'
        aria-label='Reference price for LP'
      />
      <SuggestedRefPrice store={store} decimals={decimals} quoteSym={quoteSym} />
    </>
  ),
);
import ConcentratedDefault from '@/shared/assets/liquidity-shapes/Type=Concentrated, State=Default.svg';
import ConcentratedSelected from '@/shared/assets/liquidity-shapes/Type=Concentrated, State=Selected.svg';
import StablekindDefault from '@/shared/assets/liquidity-shapes/Type=Stablekind, State=Default.svg';
import StablekindSelected from '@/shared/assets/liquidity-shapes/Type=Stablekind, State=Selected.svg';
import VolatileDefault from '@/shared/assets/liquidity-shapes/Type=Volatile, State=Default.svg';
import VolatileSelected from '@/shared/assets/liquidity-shapes/Type=Volatile, State=Selected.svg';

const LP_ADVANCED_KEY = 'veil.lp.advancedOpen';

// Order in which shape badges render. The store's enum also contains LIMIT
// and CUSTOM but neither is a user-selectable shape on this form — LIMIT is
// the limit-order form, CUSTOM comes from dragging the preview.
// Order: Concentrated, Linear, Volatile — Linear (the neutral "no strong
// view" pick) in the middle, with the directional biases on either side.
const SIMPLE_SHAPES: readonly LiquidityDistributionShape[] = [
  LiquidityDistributionShape.PYRAMID,
  LiquidityDistributionShape.FLAT,
  LiquidityDistributionShape.INVERTED_PYRAMID,
];
const SHAPE_LABELS: Partial<Record<LiquidityDistributionShape, string>> = {
  [LiquidityDistributionShape.FLAT]: 'Linear',
  [LiquidityDistributionShape.PYRAMID]: 'Concentrated',
  [LiquidityDistributionShape.INVERTED_PYRAMID]: 'Volatile',
};
const SHAPE_ART: Partial<
  Record<
    LiquidityDistributionShape,
    { Default: typeof StablekindDefault; Selected: typeof StablekindSelected }
  >
> = {
  // Asset filenames don't line up with the labels: "Concentrated"-named
  // SVGs draw the flat/uniform bar row and "Stablekind"-named SVGs draw
  // the pyramid — matches the original liquidity-shape.tsx mapping.
  [LiquidityDistributionShape.FLAT]: {
    Default: ConcentratedDefault,
    Selected: ConcentratedSelected,
  },
  [LiquidityDistributionShape.PYRAMID]: {
    Default: StablekindDefault,
    Selected: StablekindSelected,
  },
  [LiquidityDistributionShape.INVERTED_PYRAMID]: {
    Default: VolatileDefault,
    Selected: VolatileSelected,
  },
};

// Defaults we compare against to decide whether the Advanced summary chip
// should highlight a diverged value. Mirror the store: shape=FLAT,
// fee=0.1%, positions=10. If any of these drift in LPFormStore this
// list has to move with them.
const DEFAULT_SHAPE = LiquidityDistributionShape.FLAT;
const DEFAULT_FEE_PERCENT = '0.1';
const DEFAULT_POSITIONS = 10;

// Log-scaled fee slider — 0.01% at pos 0, 10% at pos FEE_SLIDER_STEPS.
// Three orders of magnitude of range would be an unusable linear picker
// (a 1px nudge = 0.1%, so anything from 0.01% to 0.1% would live in the
// bottom pixel). Log gives even resolution across the whole span and
// matches how traders think about fees (2× steps, not fixed increments).
const FEE_SLIDER_MIN = 0.01;
const FEE_SLIDER_MAX = 10;
const FEE_SLIDER_STEPS = 300; // 100 steps per decade — ~2.3% resolution
const FEE_LOG_MIN = Math.log10(FEE_SLIDER_MIN);
const FEE_LOG_MAX = Math.log10(FEE_SLIDER_MAX);
const sliderPosToFeePercent = (pos: number): number => {
  const t = Math.min(1, Math.max(0, pos / FEE_SLIDER_STEPS));
  return Math.pow(10, FEE_LOG_MIN + (FEE_LOG_MAX - FEE_LOG_MIN) * t);
};
const feePercentToSliderPos = (pctInput: number | string): number => {
  const pct = typeof pctInput === 'number' ? pctInput : parseFloat(pctInput);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  const clamped = Math.min(FEE_SLIDER_MAX, Math.max(FEE_SLIDER_MIN, pct));
  const t = (Math.log10(clamped) - FEE_LOG_MIN) / (FEE_LOG_MAX - FEE_LOG_MIN);
  return Math.round(t * FEE_SLIDER_STEPS);
};
// Fee percent → display string. Sub-0.1% needs three decimals to distinguish
// 0.012% from 0.015%; ≥1% only needs one; middle band gets two.
const formatFeePercent = (pctInput: number | string): string => {
  const pct = typeof pctInput === 'number' ? pctInput : parseFloat(pctInput);
  if (!Number.isFinite(pct)) return '0';
  if (pct < 0.1) return pct.toFixed(3).replace(/\.?0+$/, '');
  if (pct < 1) return pct.toFixed(2).replace(/\.?0+$/, '');
  return pct.toFixed(1).replace(/\.0$/, '');
};

export const LPOrderForm = observer(
  ({ parentStore }: { parentStore: OrderFormStore }) => {
    const { connected } = connectionStore;
    const { lpForm: store, defaultDecimals } = parentStore;
    const isLQTEligible = useIsLqtEligible(store.baseAsset?.metadata, store.quoteAsset?.metadata);
    const priceSpread = DEFAULT_PRICE_SPREAD;
    const priceRange = DEFAULT_PRICE_RANGE;

    // simple absolute zoom adjustment in steps of 0.05
    const [zoomAdjustment, setZoomAdjustment] = useState(0);
    const adjustedPriceRange = priceRange + zoomAdjustment;

    const [priceRanges, setPriceRanges] = useState<[number | undefined, number | undefined]>([
      undefined,
      undefined,
    ]);

    const setRanges = useCallback(() => {
      if (!store.marketPrice) {
        setPriceRanges([undefined, undefined]);
        return;
      }

      const exponent = store.quoteAsset?.exponent ?? defaultDecimals;
      setPriceRanges([
        roundToDecimals(store.marketPrice * (1 - priceSpread), exponent),
        roundToDecimals(store.marketPrice * (1 + priceSpread), exponent),
      ]);
    }, [defaultDecimals, priceSpread, store.marketPrice, store.quoteAsset?.exponent]);

    useEffect(() => {
      // set price ranges once the market price is available
      if (store.marketPrice && !priceRanges[0] && !priceRanges[1]) {
        setRanges();
      }

      // unset price ranges once the market price is unavailable
      // due to switching of asset pairs
      if (!store.marketPrice && priceRanges[0] && priceRanges[1]) {
        setRanges();
      }
    }, [store.marketPrice, priceSpread, priceRanges, setRanges]);

    // values flow from local state to form store to keep ui smooth
    useEffect(() => {
      if (priceRanges[0] && priceRanges[1]) {
        store.setLowerPriceInput(priceRanges[0]);
        store.setUpperPriceInput(priceRanges[1]);
      }
    }, [store, priceRanges]);

    // …and back the other way: when the chart's LP-preview overlay drags
    // an edge it writes straight to store.setLowerPriceInput /
    // setUpperPriceInput, bypassing the slider's local state. Sync the
    // store back into `priceRanges` so the PriceSlider handles follow
    // the drag. The setPriceRanges updater returns `prev` untouched when
    // the values match so this cannot ping-pong against the outbound
    // effect above.
    useEffect(() => {
      const storeLo = store.lowerPriceInput;
      const storeHi = store.upperPriceInput;
      if (storeLo == null || storeHi == null) return;
      setPriceRanges(prev => {
        if (prev[0] === storeLo && prev[1] === storeHi) return prev;
        return [storeLo, storeHi];
      });
    }, [store.lowerPriceInput, store.upperPriceInput]);

    const [confirmOpen, setConfirmOpen] = useState(false);

    const baseSym = store.baseAsset?.symbol ?? '';
    const quoteSym = store.quoteAsset?.symbol ?? '';
    const decimals = store.quoteAsset?.exponent ?? defaultDecimals;
    const lo = priceRanges[0];
    const hi = priceRanges[1];
    // The anchor the plan actually splits on (user reference price →
    // live mid → range midpoint). Everything derived from `mid` below —
    // confirm rows, range-width %, off-mid warnings — describes the
    // ladder being submitted, so it must use the same source.
    const mid = store.effectiveMarketPrice;
    const liveMid = store.marketPrice;
    const rangeCoversMid =
      mid != null && lo !== undefined && hi !== undefined && mid >= lo && mid <= hi;

    // The number of positions that will actually be opened, which is not
    // necessarily the number requested: rungs whose reserves round to zero
    // base units are dropped, because the chain rejects the whole transaction
    // over a single empty position. Before that filter these were always
    // equal; now they diverge exactly when the amount is marginal — which is
    // precisely when the user needs the honest number.
    // `rungs`, not `plan`: same filtered count, without building the protos
    // (and drawing a nonce per rung) on every mid-price tick.
    const actualPositions = store.rungs?.length ?? store.positions;

    const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
      const rows: ConfirmInfoRow[] = [];
      if (mid != null) {
        rows.push({
          label: 'Anchor mid',
          value: `${roundToDecimals(mid, decimals)} ${quoteSym}`,
        });
      }
      // When a reference price overrides the live mid, show both so the
      // user sees what the ladder is anchored to vs. where the market is.
      if (liveMid != null && liveMid !== mid) {
        rows.push({
          label: 'Live market mid',
          value: `${roundToDecimals(liveMid, decimals)} ${quoteSym}`,
        });
      }
      if (lo !== undefined && hi !== undefined) {
        rows.push({
          label: 'Range',
          value: `${roundToDecimals(lo, decimals)} → ${roundToDecimals(hi, decimals)} ${quoteSym}`,
        });
        if (mid != null && mid > 0) {
          const lowerPct = ((mid - lo) / mid) * 100;
          const upperPct = ((hi - mid) / mid) * 100;
          const symmetric = Math.abs(lowerPct - upperPct) < 0.05;
          rows.push({
            label: 'Range width',
            value: symmetric
              ? `±${Math.abs(lowerPct).toFixed(2)}%`
              : `-${lowerPct.toFixed(2)}% / +${upperPct.toFixed(2)}%`,
          });
        }
      }
      rows.push({ label: 'Positions', value: String(actualPositions) });
      rows.push({
        label: `${baseSym || 'Base'} amount`,
        value: store.baseInput || '—',
      });
      rows.push({
        label: `${quoteSym || 'Quote'} amount`,
        value: store.quoteInput || '—',
      });
      rows.push({
        label: 'LQT rewards',
        value: isLQTEligible ? 'Eligible' : 'Not eligible',
        valueColor: isLQTEligible ? 'success' : undefined,
      });
      rows.push({
        label: 'Position fee',
        value: `${store.feeTierPercentInput}%`,
      });
      rows.push({
        label: 'Gas fee',
        value: `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`,
      });
      return rows;
    }, [
      mid,
      liveMid,
      lo,
      hi,
      decimals,
      baseSym,
      quoteSym,
      actualPositions,
      store.baseInput,
      store.quoteInput,
      store.feeTierPercentInput,
      isLQTEligible,
      parentStore.gasFee.display,
      parentStore.gasFee.symbol,
    ]);

    const confirmWarnings = useMemo<ConfirmWarning[]>(() => {
      if (mid == null || lo === undefined || hi === undefined) return [];
      if (rangeCoversMid) return [];
      // One-sided plans get their own dedicated notice; skip the range
      // warning so the confirm modal doesn't say the same thing twice.
      if (store.isOneSided) return [];
      const aboveMid = mid > hi;
      return [
        {
          key: 'range-warning',
          message: aboveMid
            ? "Mid above range — fully ASK side, won't fill bids until price drops in"
            : "Mid below range — fully BID side, won't fill asks until price rises in",
        },
      ];
    }, [mid, lo, hi, rangeCoversMid, store.isOneSided]);

    // Say what the user gives and what they get back, in a sentence, before
    // they sign. "Open 10 LP positions between X and Y" describes the
    // mechanism but never mentions the amounts leaving the wallet, the fee
    // being charged, or the condition under which any of it earns anything.
    const actionLabel = useMemo(() => {
      // Gate on the amount *before* formatting. `baseAssetAmount` returns a
      // formatted "0 UM" — a truthy string — whenever a plan exists, so a
      // `??` fallback never fires and a one-sided position would read
      // "You provide 0 UM and 100 USDC".
      const provided = [
        store.baseLiquidity > 0 ? (store.baseAssetAmount ?? `${store.baseInput} ${baseSym}`) : null,
        store.quoteLiquidity > 0
          ? (store.quoteAssetAmount ?? `${store.quoteInput} ${quoteSym}`)
          : null,
      ].filter(Boolean);

      if (provided.length === 0) {
        return `Open ${actualPositions} liquidity positions`;
      }
      return `You provide ${provided.join(' and ')}`;
    }, [
      store.baseAssetAmount,
      store.quoteAssetAmount,
      store.baseLiquidity,
      store.quoteLiquidity,
      store.baseInput,
      store.quoteInput,
      actualPositions,
      baseSym,
      quoteSym,
    ]);

    const subLabel = useMemo(() => {
      const where =
        lo !== undefined && hi !== undefined
          ? ` between ${roundToDecimals(lo, decimals)} and ${roundToDecimals(hi, decimals)} ${quoteSym} per ${baseSym}`
          : '';
      const earn = store.isOneSided
        ? 'Because only one side is funded, it fills — and starts earning — once the market trades into your range.'
        : 'You earn that fee whenever someone trades against your positions inside the range.';
      return `Split across ${actualPositions} positions${where}, each charging ${store.feeTierPercentInput}%. ${earn} You can close them at any time to take your funds back.`;
    }, [
      lo,
      hi,
      decimals,
      quoteSym,
      baseSym,
      actualPositions,
      store.feeTierPercentInput,
      store.isOneSided,
    ]);

    const openConfirm = useCallback(() => setConfirmOpen(true), []);
    const closeConfirm = useCallback(() => setConfirmOpen(false), []);
    const handleConfirm = useCallback(() => {
      setConfirmOpen(false);
      void parentStore.submit();
    }, [parentStore]);

    // Advanced disclosure — collapsed by default, persisted per-user (not
    // per-pair). Auto-opens once per form mount when the plan diverges
    // from defaults (one-sided funding, range off-mid, non-default
    // shape/fee/positions) so the trader sees the knobs they'll want to
    // adjust. Manual toggle wins for the rest of the session.
    //
    // localStorage is read in an effect (not a useState initializer) so
    // the server and initial client render agree on `false` and hydration
    // doesn't mismatch on aria-expanded.
    const autoOpenedRef = useRef(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    useEffect(() => {
      try {
        if (window.localStorage.getItem(LP_ADVANCED_KEY) === '1') {
          setAdvancedOpen(true);
        }
      } catch {
        // storage disabled — leave collapsed
      }
    }, []);
    const persistAdvanced = useCallback((next: boolean) => {
      try {
        window.localStorage.setItem(LP_ADVANCED_KEY, next ? '1' : '0');
      } catch {
        // best effort
      }
    }, []);
    const toggleAdvanced = useCallback(() => {
      setAdvancedOpen(prev => {
        const next = !prev;
        persistAdvanced(next);
        // Manual toggle wins for the rest of the session — mark auto-
        // open done so a later one-sided edit can't re-open a form the
        // trader just deliberately closed.
        autoOpenedRef.current = true;
        return next;
      });
    }, [persistAdvanced]);
    useEffect(() => {
      if (autoOpenedRef.current) return;
      const isOneSided = store.isOneSided;
      const rangeOffMid =
        mid != null && lo !== undefined && hi !== undefined && !rangeCoversMid;
      const shapeNonDefault =
        store.liquidityShape !== DEFAULT_SHAPE &&
        store.liquidityShape !== LiquidityDistributionShape.CUSTOM;
      const feeNonDefault = store.feeTierPercentInput !== DEFAULT_FEE_PERCENT;
      const positionsNonDefault = store.positions !== DEFAULT_POSITIONS;
      if (isOneSided || rangeOffMid || shapeNonDefault || feeNonDefault || positionsNonDefault) {
        autoOpenedRef.current = true;
        setAdvancedOpen(prev => {
          if (prev) return prev;
          persistAdvanced(true);
          return true;
        });
      }
    }, [
      persistAdvanced,
      store.isOneSided,
      store.liquidityShape,
      store.feeTierPercentInput,
      store.positions,
      mid,
      lo,
      hi,
      rangeCoversMid,
    ]);

    // More-menu inside the Price Range header holding log/linear + zoom +
    // reset. Dismisses on outside click or Escape; menu items dismiss it
    // themselves so a click doesn't leave the popover hanging.
    const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
    useEffect(() => {
      if (!rangeMenuOpen) return;
      const onDoc = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('[data-range-menu]')) return;
        setRangeMenuOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setRangeMenuOpen(false);
      };
      window.addEventListener('mousedown', onDoc);
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('mousedown', onDoc);
        window.removeEventListener('keydown', onKey);
      };
    }, [rangeMenuOpen]);
    const closeRangeMenu = useCallback(() => setRangeMenuOpen(false), []);

    const shapeLabel =
      SHAPE_LABELS[store.liquidityShape] ??
      (store.liquidityShape === LiquidityDistributionShape.CUSTOM ? 'Custom' : '—');
    const advancedSummary = `${shapeLabel} · ${store.feeTierPercentInput}% · ${actualPositions} pos`;
    const advancedDiverged =
      (store.liquidityShape !== DEFAULT_SHAPE &&
        store.liquidityShape !== LiquidityDistributionShape.CUSTOM) ||
      store.feeTierPercentInput !== DEFAULT_FEE_PERCENT ||
      store.positions !== DEFAULT_POSITIONS;

    const renderAmountInput = (
      side: 'base' | 'quote',
      value: string,
      onChange: (v: string) => void,
      asset: typeof store.baseAsset,
    ) => (
      <div className='flex flex-col gap-1'>
        <Density compact>
          <TextInput
            type='number'
            typography='large'
            blurOnWheel
            value={value}
            maxDecimals={store.quoteAsset?.exponent ?? defaultDecimals}
            onChange={onChange}
            endAdornment={
              asset?.symbol && (
                <div className='flex shrink-0 items-center gap-1 font-default text-text-sm leading-text-xs font-normal text-text-secondary'>
                  {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- its necessary */}
                  {asset?.metadata?.images?.[0]?.svg && (
                    <Image
                      className='h-4 w-4 rounded-full'
                      src={asset.metadata.images[0].svg}
                      alt={asset.symbol}
                      width={16}
                      height={16}
                    />
                  )}
                  <div>{asset.symbol}</div>
                </div>
              )
            }
          />
        </Density>
        {asset?.formatBalance() && (
          <button
            type='button'
            className='flex items-center gap-1 text-[10px] leading-none text-text-secondary hover:text-text-primary'
            onClick={() => {
              const target = asset?.balance?.toString();
              if (target) {
                if (side === 'base') store.setBaseInput(target);
                else store.setQuoteInput(target);
              }
            }}
          >
            <span className='truncate font-mono'>{asset.formatBalance()}</span>
            <span className='text-primary-light hover:underline'>Max</span>
          </button>
        )}
      </div>
    );

    return (
      <div className='flex flex-col p-3'>
        {/* Amounts — two-column grid. No header row; the token symbol in
            each input's end-adornment identifies each side, and the
            balance/Max line below tells the trader what they have to
            spend. */}
        <div className='mb-2 grid grid-cols-2 gap-2'>
          {renderAmountInput('base', store.baseInput, store.setBaseInput, store.baseAsset)}
          {renderAmountInput('quote', store.quoteInput, store.setQuoteInput, store.quoteAsset)}
        </div>

        {/* Reference price — user-editable "for this LP, treat X as mid".
            Overrides the live-derived mid in every planner calculation
            (bid/ask split, wrongSide detection, opposite-input auto-fill).
            Chain doesn't have a canonical mid — it just holds positions
            — so the user gets the final word. Blank = fall back to live
            mid → range midpoint. Placeholder previews the current auto
            value so users know what the default would be. */}
        <div className='mb-2'>
          <div className='mb-1 flex items-center gap-1 leading-none'>
            <Text small color='text.secondary'>
              Reference price
            </Text>
            <Tooltip message='Your view of what fair value is for this LP. Overrides the live-derived mid for the ladder split, so you can build a two-sided LP inside a wide spread by naming your own mid (e.g. "1" for a USDC/USDC.inj peg trade). Chain accepts positions at any price — this is a UI opinion. Blank = use the live market mid.'>
              <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
            </Tooltip>
          </div>
          <ReferencePriceInput store={store} decimals={decimals} quoteSym={quoteSym} />
        </div>

        {/* Price Range — header collapses to label on the left, More menu
            on the right. Log/linear + zoom + reset live inside the More
            menu so the header stays a single line. Quick-range chips sit
            below the slider as one flat row. */}
        <div className='mb-2'>
          <div className='mb-1 flex items-center justify-between gap-2 leading-none'>
            <div className='flex items-center gap-1'>
              <Text small color='text.secondary'>
                Price Range
              </Text>
              <Tooltip message='Defines the range of prices where your liquidity will be active. You earn fees only when trades happen within this range.'>
                <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
              </Tooltip>
            </div>
            <div className='relative' data-range-menu>
              <button
                type='button'
                onClick={() => setRangeMenuOpen(v => !v)}
                className='flex h-6 w-6 items-center justify-center rounded-sm text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary'
                aria-label='Range spacing and zoom'
                aria-expanded={rangeMenuOpen}
              >
                <MoreHorizontal className='h-4 w-4' />
              </button>
              {rangeMenuOpen && (
                <div className='absolute right-0 top-7 z-20 min-w-[160px] rounded-md border border-other-tonal-stroke bg-base-black p-1 text-xs shadow-lg'>
                  <button
                    type='button'
                    onClick={() => {
                      setZoomAdjustment(prev => Math.min(0.25, prev + 0.05));
                      closeRangeMenu();
                    }}
                    className='flex w-full items-center gap-2 rounded-sm px-2 py-1 text-text-primary hover:bg-action-hover-overlay'
                  >
                    <ZoomOut aria-hidden className='h-3.5 w-3.5' /> Zoom out
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      setZoomAdjustment(prev => Math.max(-0.25, prev - 0.05));
                      closeRangeMenu();
                    }}
                    className='flex w-full items-center gap-2 rounded-sm px-2 py-1 text-text-primary hover:bg-action-hover-overlay'
                  >
                    <ZoomIn aria-hidden className='h-3.5 w-3.5' /> Zoom in
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      setZoomAdjustment(0);
                      setRanges();
                      closeRangeMenu();
                    }}
                    className='w-full rounded-sm px-2 py-1 text-left text-text-primary hover:bg-action-hover-overlay'
                  >
                    Reset range
                  </button>
                </div>
              )}
            </div>
          </div>
          <PriceSlider
            min={store.marketPrice ? store.marketPrice * (1 - adjustedPriceRange) : 0}
            max={
              store.marketPrice ? store.marketPrice * (1 + adjustedPriceRange) : Infinity
            }
            values={priceRanges}
            onInput={setPriceRanges}
            quoteExponent={store.quoteAsset?.exponent ?? defaultDecimals}
            marketPrice={store.marketPrice}
            quoteAsset={store.quoteAsset}
            baseAsset={store.baseAsset}
          />
          {store.marketPrice && (
            <div className='mt-2 flex items-center gap-1'>
              {[0.01, 0.025, 0.05, 0.1, 0.25, 0.5].map(pct => {
                const mid = store.marketPrice as number;
                const exponent = store.quoteAsset?.exponent ?? defaultDecimals;
                const lo = roundToDecimals(mid * (1 - pct), exponent);
                const hi = roundToDecimals(mid * (1 + pct), exponent);
                const isActive =
                  priceRanges[0] !== undefined &&
                  priceRanges[1] !== undefined &&
                  Math.abs(priceRanges[0] - lo) / mid < 0.001 &&
                  Math.abs(priceRanges[1] - hi) / mid < 0.001;
                return (
                  <button
                    key={pct}
                    type='button'
                    onClick={() => {
                      setPriceRanges([lo, hi]);
                      const needed = pct + 0.05;
                      setZoomAdjustment(prev =>
                        needed > priceRange + prev ? needed - priceRange : prev,
                      );
                    }}
                    className={cn(
                      'h-6 flex-1 rounded-sm px-1 text-[10px] tabular-nums transition-colors',
                      isActive
                        ? 'bg-primary-main text-base-black'
                        : 'bg-other-tonal-fill5 text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary',
                    )}
                  >
                    ±{Number.isInteger(pct * 100) ? String(pct * 100) : (pct * 100).toFixed(1)}%
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Advanced disclosure — shape, fee tier, position count. Collapsed
            by default; auto-opens when the plan diverges from defaults.
            Persisted in localStorage per-user (not per-pair). */}
        <div className='mb-2'>
          <button
            type='button'
            aria-expanded={advancedOpen}
            aria-controls='lp-advanced-panel'
            onClick={toggleAdvanced}
            className='flex h-8 w-full items-center justify-between rounded-md border border-other-tonal-stroke px-2 text-xs hover:bg-action-hover-overlay'
          >
            <div className='flex items-center gap-1.5'>
              <SlidersHorizontal aria-hidden className='h-3.5 w-3.5 text-text-secondary' />
              <span className='text-text-primary'>Advanced</span>
            </div>
            <div className='flex min-w-0 items-center gap-1.5'>
              <span
                className={cn(
                  'truncate tabular-nums',
                  advancedDiverged ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {advancedSummary}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  'h-3.5 w-3.5 text-text-secondary transition-transform',
                  advancedOpen && 'rotate-180',
                )}
              />
            </div>
          </button>
          {advancedOpen && (
            <div
              id='lp-advanced-panel'
              className='mt-1.5 flex flex-col gap-1.5 rounded-md border border-other-tonal-stroke p-2'
            >
              {/* Shape badges — SVG illustration lives as a low-opacity
                  watermark behind the label. ~half the height of the
                  original stacked tiles, so all three fit in one tight
                  row without losing the visual identity of the shape. */}
              <div>
                <div className='mb-1 flex items-center gap-1 leading-none'>
                  <Text small color='text.secondary'>
                    Shape
                  </Text>
                  <Tooltip message='Select how your liquidity is distributed across the price range.'>
                    <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
                  </Tooltip>
                </div>
                <div className='flex w-full gap-2'>
                  {SIMPLE_SHAPES.map(shape => {
                    const art = SHAPE_ART[shape];
                    if (!art) return null;
                    const selected = store.liquidityShape === shape;
                    const Bg = selected ? art.Selected : art.Default;
                    return (
                      <button
                        key={shape}
                        type='button'
                        onClick={() => store.setLiquidityShape(shape)}
                        aria-pressed={selected}
                        className={cn(
                          'group relative h-11 flex-1 overflow-hidden rounded-sm border transition-colors',
                          selected
                            ? 'border-primary-main bg-other-tonal-fill5'
                            : 'border-transparent bg-other-tonal-fill5 hover:border-other-tonal-stroke',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity',
                            selected
                              ? 'opacity-70'
                              : 'opacity-30 group-hover:opacity-50',
                          )}
                        >
                          <Bg className='h-8 w-auto' />
                        </span>
                        <span
                          className={cn(
                            'relative z-10 flex h-full items-center justify-center text-xs font-medium',
                            selected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary',
                          )}
                          style={{
                            textShadow:
                              '0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)',
                          }}
                        >
                          {SHAPE_LABELS[shape]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div className='min-w-0'>
                  <div className='mb-1 flex items-baseline justify-between gap-1 leading-none'>
                    <div className='flex items-center gap-1'>
                      <Text small color='text.secondary'>
                        Fee
                      </Text>
                      <Tooltip message='The fee your positions charge takers, and therefore what you earn on every trade that crosses them. Stable pairs are conventionally 0.05%, most pairs 0.1–0.3%, and thin or volatile pairs higher to cover inventory risk. Log-scaled from 0.01% to 10%.'>
                        <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
                      </Tooltip>
                    </div>
                    <div className='flex items-baseline gap-1'>
                      <input
                        type='text'
                        inputMode='decimal'
                        value={store.feeTierPercentInput}
                        onChange={e => {
                          // Accept the raw typed value; the store's setter
                          // normalises and clamps. Empty input is fine (it
                          // becomes 0 downstream) so the user can clear the
                          // field and retype.
                          store.setFeeTierPercentInput(
                            e.target.value.replace(/[^0-9.]/g, ''),
                          );
                        }}
                        onBlur={() => {
                          // On blur, snap the input to the formatted / clamped
                          // representation so the display stays canonical
                          // (e.g. "0.10" → "0.1", "12" → "10" after clamp).
                          const clamped = Math.min(
                            FEE_SLIDER_MAX,
                            Math.max(0, store.feeTierPercent),
                          );
                          store.setFeeTierPercentInput(formatFeePercent(clamped));
                        }}
                        aria-label='Fee percent'
                        className='h-4 w-12 rounded-sm bg-other-tonal-fill5 px-1 text-right text-xs tabular-nums text-text-primary outline-none focus:ring-1 focus:ring-primary-main'
                      />
                      <span className='text-text-secondary'>%</span>
                    </div>
                  </div>
                  <input
                    type='range'
                    min={0}
                    max={FEE_SLIDER_STEPS}
                    step={1}
                    value={feePercentToSliderPos(store.feeTierPercent)}
                    onChange={e => {
                      const pct = sliderPosToFeePercent(Number(e.target.value));
                      store.setFeeTierPercentInput(formatFeePercent(pct));
                    }}
                    aria-label='Fee percent slider'
                    className='w-full cursor-pointer accent-primary-main'
                  />
                </div>
                <div className='min-w-0'>
                  <div className='mb-1 flex items-baseline justify-between gap-1 leading-none'>
                    <div className='flex items-center gap-1'>
                      <Text small color='text.secondary'>
                        Positions
                      </Text>
                      <Tooltip message='How many concentrated-liquidity slots to open across the range. More rungs give tighter market coverage; fewer rungs mean each rung carries more of your capital.'>
                        <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
                      </Tooltip>
                    </div>
                    <Text detail color='text.primary' as='span'>
                      <span className='tabular-nums'>{store.positions}</span>
                    </Text>
                  </div>
                  <input
                    type='range'
                    min={1}
                    max={20}
                    step={1}
                    value={store.positions}
                    onChange={e => store.setPositions(Number(e.target.value))}
                    aria-label='Position count'
                    className='w-full cursor-pointer accent-primary-main'
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Compact summary line — one sentence of prose replaces the InfoRow
            stack. Full detail still available in the pre-submit confirm
            modal so a curious trader can drill in there. */}
        <div className='mb-2 text-[11px] leading-tight text-text-secondary'>
          {(() => {
            const parts: string[] = [];
            if (mid != null && lo !== undefined && hi !== undefined && mid > 0) {
              const lowerPct = ((mid - lo) / mid) * 100;
              const upperPct = ((hi - mid) / mid) * 100;
              const symmetric = Math.abs(lowerPct - upperPct) < 0.05;
              parts.push(
                symmetric
                  ? `±${Math.abs(lowerPct).toFixed(2)}%`
                  : `-${lowerPct.toFixed(2)}% / +${upperPct.toFixed(2)}%`,
              );
            }
            parts.push(`${store.feeTierPercentInput}% fee`);
            parts.push(`${actualPositions} pos`);
            if (LQT_ENABLED && isLQTEligible) parts.push('LQT eligible');
            parts.push(
              `gas ${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`,
            );
            return parts.join(' · ');
          })()}
        </div>
        {/* Off-mid warning — only when BOTH sides are funded but the
            range still misses mid. The one-sided case already gets a
            more targeted "One-sided position: earns fees once the
            market trades into your range" notice via FormIssueNotice
            further down, so this red block would double up. */}
        {(() => {
          if (
            mid == null ||
            lo === undefined ||
            hi === undefined ||
            mid <= 0 ||
            lo <= 0 ||
            hi <= 0
          ) {
            return null;
          }
          if (mid >= lo && mid <= hi) return null;
          if (store.isOneSided) return null;
          const aboveMid = mid > hi;
          return (
            <div className='mb-2 rounded-sm border border-destructive-light/30 bg-destructive-light/10 px-2 py-1 text-[11px] leading-tight text-destructive-light'>
              ⚠{' '}
              {aboveMid
                ? "Mid above range — fully ASK side, won't fill bids until price drops in"
                : "Mid below range — fully BID side, won't fill asks until price rises in"}
            </div>
          );
        })()}

        {/* Submit — sticky so it never leaves the fold regardless of
            Advanced state. */}
        <div className='sticky bottom-0 -mx-3 -mb-3 border-t border-other-tonal-stroke bg-base-black/95 px-3 pb-3 pt-2 backdrop-blur-sm'>
          {connected ? (
            <Button actionType='accent' disabled={!parentStore.canSubmit} onClick={openConfirm}>
              Add Liquidity
            </Button>
          ) : (
            <ConnectButton actionType='default' />
          )}
          {connected && <FormIssueNotice issue={parentStore.formNotice} />}
        </div>
        <ConfirmOrderModal
          isOpen={confirmOpen}
          actionLabel={actionLabel}
          subLabel={subLabel}
          rows={confirmRows}
          warnings={confirmWarnings}
          confirmDisabled={!parentStore.canSubmit}
          confirmLabel='Add Liquidity'
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
      </div>
    );
  },
);

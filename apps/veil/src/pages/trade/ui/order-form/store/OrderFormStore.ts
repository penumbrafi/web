import { useCallback, useEffect } from 'react';
import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { LimitOrderFormStore } from './LimitOrderFormStore';
import { MarketOrderFormStore } from './MarketOrderFormStore';
import { RangeOrderFormStore } from './RangeOrderFormStore';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import {
  Address,
  AddressIndex,
  AddressView,
} from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { usePathQuery, usePathToMetadata } from '@/pages/trade/model/use-path';
import { useBalances } from '@/shared/api/balances';
import { connectionStore } from '@/shared/model/connection';
import { useSubaccounts } from '@/widgets/header/api/subaccounts';
import { useMarketPrice } from '@/pages/trade/model/useMarketPrice';
import { pnum } from '@penumbra-zone/types/pnum';
import debounce from 'lodash/debounce';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { planTransaction, planBuildBroadcast } from '@/entities/transaction';
import { describeTxError } from '@/entities/transaction/model/describe-error';
import { openToast } from '@penumbra-zone/ui/Toast';
import {
  getMetadataFromBalancesResponse,
  getAmount,
  getAddressIndex,
} from '@penumbra-zone/getters/balances-response';
import { isMetadataEqual } from '@/shared/utils/is-metadata-equal';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getAssetMetadataById } from '@/shared/api/metadata';
import { updatePositionsQuery } from '@/entities/position';
import { queryClient } from '@/shared/const/queryClient';
import { LPFormStore, type OffMidWarningKind } from './LPFormStore';
import { encodeLiquidityShape } from '@/shared/math/position';
import {
  blockingIssue,
  rungRequirements,
  validateOrder,
  type FormIssue,
  type Requirement,
} from './validate';
import { parseNumber } from '@/shared/utils/num';

// Single frozen "no estimate" value. `resetGasFee` used to write a fresh
// `{symbol, display}` literal on every call — and it was called from inside
// the `plan` getter on every read — so `issues` / `blockingIssue` /
// `formNotice` / `canSubmit` were notified per block even when the fee had
// not changed. One shared identity lets mobx see "same value, no change".
const EMPTY_FEE: { symbol: string; display: string } = Object.freeze({
  symbol: 'UM',
  display: '--',
});

export type WhichForm = 'Market' | 'Limit' | 'RangeLP' | 'LP';

/**
 * Kick the trade-page market-data queries after a local swap or LP action so
 * the book, tape and chart reflect the just-landed change immediately, rather
 * than waiting for the next block tick (~5s) or pindexer tick to bring them
 * in. The user's own action is strictly a later event than the block that
 * carried it, so re-fetching now is safe — it can only see the post-tx state.
 * Predicate-based so it hits every base/quote/traceLimit/durationWindow
 * variant currently mounted in the trade page.
 */
const invalidateMarketDataQueries = async (
  pair?: { base?: string; quote?: string },
  opts?: { skipBook?: boolean; skipBalances?: boolean },
): Promise<void> => {
  // Every trade-page query that reflects post-tx state. `my-trades` and
  // `my-executions` are the "my activity" panels. `view-service-balances`
  // is what the order form validates against — without it the balance
  // stays pre-tx until the next unrelated refresh.
  //
  // `opts.skipBook`: the swapClaim doesn't move the book/tape/candles,
  // only balances/positions, so calling after the claim is 4 wasted
  // pd simulates. Post-swap: full sweep; post-claim: only balances.
  const baseKeys = ['book', 'recent-executions', 'my-trades', 'my-executions',
    'latest-candles', 'infinite-candles', 'summary'];
  const balanceKeys = ['view-service-balances'];
  const keys = [
    ...(opts?.skipBook ? [] : baseKeys),
    ...(opts?.skipBalances ? [] : balanceKeys),
  ];

  // Server has a 6s stale-while-revalidate cache on /api/book. The
  // priming fetches MUST complete before we invalidate — an un-awaited
  // fire-and-forget prime races the RQ refetch, which reaches the
  // server while the prime's ~1s pd compute is still in-flight and
  // gets served the OLD cached entry. So await both prime fetches;
  // 500ms wait is a fair trade for actually-fresh mid/ladder.
  if (!opts?.skipBook && pair?.base && pair.quote) {
    const q = new URLSearchParams({
      baseAsset: pair.base,
      quoteAsset: pair.quote,
      nocache: '1',
    });
    const primes = [30, 100].map(limit => {
      const params = new URLSearchParams(q);
      params.set('traceLimit', String(limit));
      return fetch(`/api/book?${params.toString()}`).catch(() => undefined);
    });
    // allSettled so a single-side failure doesn't skip invalidation —
    // the next block-tick refetch is our safety net either way.
    await Promise.allSettled(primes);
  }

  // `cancelRefetch: false` because both the block-tick refresh path
  // (compact-block) and the pindexer-tick path (useOnPindexerTick) call
  // `invalidateQueries` on the same keys; without this, whichever
  // arrives second aborts the first's in-flight fetch (RQ v5 default is
  // `cancelRefetch: true`), so a two-hop positions fetch that started
  // on a block tick gets restarted from scratch when the dex_ex tick
  // lands 100ms later.
  await queryClient.invalidateQueries({
    predicate: q => typeof q.queryKey[0] === 'string' && keys.includes(q.queryKey[0]),
    refetchType: 'active',
  }, { cancelRefetch: false });
};

export const isWhichForm = (x: string): x is WhichForm => {
  return x === 'Market' || x === 'Limit' || x === 'RangeLP' || x === 'LP';
};

const GAS_DEBOUNCE_MS = 320;

export class OrderFormStore {
  private _market = new MarketOrderFormStore();
  private _limit = new LimitOrderFormStore();
  private _range = new RangeOrderFormStore();
  private _lp = new LPFormStore();
  private _whichForm: WhichForm = 'Market';
  private _submitting = false;
  // Monotonically-increasing token for the debounced gas-fee estimator.
  // Every invocation captures the token at start; only the LATEST
  // invocation's response is allowed to write back to `_gasFee` /
  // `_planError`. Without this, a slow first plan's rejection can arrive
  // after a fresh plan's success and pin an outdated blocking error
  // under the submit button until the user changes an input.
  private _gasFeeToken = 0;
  private _marketPrice: number | undefined = undefined;
  address?: Address;
  subAccountIndex?: AddressIndex;
  private _feeAsset?: AssetInfo;
  // Cached reference to the staking-token (UM) AssetInfo so the fee-reset
  // branch in `estimateGasFee` can restore the default without an async
  // registry lookup. Set alongside `setFeeAsset` when UM is chosen at
  // mount, and never overwritten by `setAlternativeFee`.
  private _umFeeAsset?: AssetInfo;
  private _gasFee: { symbol: string; display: string } = EMPTY_FEE;
  private _gasFeeLoading = false;
  /** The planner's own rejection of the current form, if it has one. */
  private _planError?: string;
  defaultDecimals = 6;
  highlight = false;

  constructor() {
    // `_gasFee` must be a *reference* observable. The default (deep)
    // annotation would copy any assigned object into a fresh observable
    // proxy, so `this._gasFee === EMPTY_FEE` could never hold and the
    // "only write when changed" guard in `resetGasFee` would be a no-op.
    // Every write to it is a whole-object assignment, so `ref` is safe.
    makeAutoObservable<this, '_gasFee'>(this, { _gasFee: observable.ref });

    // Watch a structural fingerprint, not `this.plan`'s reference. The
    // plan getter rebuilds a fresh array on every mid-price tick (because
    // the per-position price split shifts when mid moves) but the
    // wire-level gas cost is ~ proportional to the *number* of
    // positions and the active form, not where each rung sits. The old
    // form fired planTransaction every block on a populated LP form
    // for an estimate that almost never changed; the new fingerprint
    // fires only when the shape of the transaction actually shifts.
    const debouncedEstimate = debounce(() => void this.estimateGasFee(), GAS_DEBOUNCE_MS);
    reaction(
      () => {
        // `planShape`, not `plan`: the shape is derived from the cheap
        // `rungs` / `hasPlan` getters, so evaluating this fingerprint on a
        // mid-price tick does not build protos or draw nonces.
        const shape = this.planShape;
        if (!shape) {
          return `none|${this._whichForm}|${this.inputFingerprint}`;
        }
        // positionOpens is the LP path, swaps is the Market path,
        // swapClaims/positionCloses for the close/withdraw flows. Sum
        // gives a stable structural count that doesn't shift on per-
        // tick price re-allocation.
        //
        // The amounts the user typed are folded in as well, because this
        // call is no longer only a gas estimate — it is also the planner
        // dry-run that catches whatever `validateOrder` cannot enumerate,
        // and *that* has to re-run when the size changes even though the
        // transaction's shape does not. Mid-price ticks are still excluded,
        // so a populated LP form does not re-plan every block.
        return `${shape.opens}/${shape.swaps}|${this._whichForm}|${this.inputFingerprint}`;
      },
      fingerprint => {
        // The `plan` getter used to reset the fee as a side effect of
        // being read with an incomplete form. A computed must not mutate
        // observable state, so the reset lives here: the moment the plan
        // goes away, clear the stale estimate synchronously (the debounced
        // estimator would also do it, 320ms later).
        if (fingerprint.startsWith('none|')) {
          this.resetGasFee();
        }
        debouncedEstimate();
      },
    );

    // When the wallet unlocks mid-session, re-fire the estimator so
    // gas / fee-asset / _planError all recover without the user having
    // to edit an input. Otherwise the sync bar clears, the amber
    // banner disappears, but `_gasFee` sticks at "--" — which then
    // silently bypasses the fee-headroom check in validate.ts
    // (`parseNumber('--')` returns undefined) and a MAX order can be
    // submitted while the wallet is still catching up. Invalidate
    // balances too, since those queries all errored while locked and
    // won't retry until something triggers them.
    connectionStore.onWalletUnlock(() => {
      void queryClient.invalidateQueries({
        predicate: q =>
          typeof q.queryKey[0] === 'string' &&
          ['view-service-balances', 'positions', 'my-trades'].includes(q.queryKey[0]),
      });
      void this.estimateGasFee();
    });
  }

  /**
   * The user-typed state of the active form, as a string.
   *
   * Deliberately excludes anything that moves on its own (mid price, live
   * balances) so it changes when — and only when — the user edits the order.
   */
  private get inputFingerprint(): string {
    switch (this._whichForm) {
      case 'Market':
        return `${this._market.direction}|${this._market.baseInput}|${this._market.quoteInput}`;
      case 'Limit':
        return `${this._limit.direction}|${this._limit.baseInput}|${this._limit.quoteInput}|${this._limit.priceInput}`;
      case 'RangeLP':
        return `${this._range.liquidityTargetInput}|${this._range.lowerPriceInput}|${this._range.upperPriceInput}|${this._range.feeTierPercentInput}`;
      case 'LP':
        return `${this._lp.baseInput}|${this._lp.quoteInput}|${this._lp.lowerPriceInput}|${this._lp.upperPriceInput}|${this._lp.feeTierPercentInput}`;
    }
  }

  private estimateGasFee = async (): Promise<void> => {
    // Bump the token BEFORE the plan-empty early return so an older
    // in-flight estimate can't "own" the current token and pin a
    // `_planError` for a plan the user has since cleared.
    const myToken = ++this._gasFeeToken;
    // Read `plan` exactly once: it builds the positions (with fresh nonces)
    // on every read now that it is no longer cached by an observer.
    const plan = this.plan;
    if (!plan) {
      this.resetGasFee();
      return;
    }

    runInAction(() => {
      this._gasFeeLoading = true;
      this._planError = undefined;
    });
    try {
      const res = await planTransaction(plan);
      // If a fresher estimate started while we were in flight, drop
      // this response on the floor — writing back would clobber the
      // newer plan's verdict with stale state.
      if (myToken !== this._gasFeeToken) {return;}
      const fee = res.transactionParameters?.fee;
      if (!fee) {
        this.resetGasFee();
        return;
      }
      // Protocol convention (per `fee.rs`): `Fee.asset_id` is None when
      // the fee is paid in UM (the staking token). It's set only when
      // the planner routed to an alternative asset because the user
      // couldn't cover UM gas from their notes. Historically we only
      // handled the "set → switch to alt" direction; the reverse
      // ("cleared → revert to UM") was silently ignored, so once the
      // planner picked (say) USDC gas for one plan, `_feeAsset` stayed
      // on USDC on every subsequent plan even when the on-chain fee
      // was back in UM — the display showed the wrong symbol and
      // exponent, and validation used the wrong asset's balance.
      const feeAssetId = res.transactionParameters?.fee?.assetId;
      if (feeAssetId) {
        // Registry lookup + metadata resolution — awaits the network.
        // Re-check the token AFTER the await so a fresh estimate
        // that started during the lookup wins instead of the stale
        // one clobbering it.
        await this.setAlternativeFee(feeAssetId);
      }
      if (myToken !== this._gasFeeToken) {return;}
      runInAction(() => {
        if (!feeAssetId && this._umFeeAsset && !this._feeAsset?.id.equals(this._umFeeAsset.id)) {
          // Revert to UM whenever the planner didn't specify an alt.
          this._feeAsset = this._umFeeAsset;
        }

        if (!this._feeAsset) {
          return;
        }

        this._gasFee = {
          symbol: this._feeAsset.symbol,
          display: pnum(fee.amount, this._feeAsset.exponent).toNumber().toString(),
        };
      });
    } catch (e) {
      // This call is the planner's own verdict on the transaction we are
      // about to ask the user to sign, and it was being thrown away. Keep
      // it: the planner sees the real note set, the real gas price and the
      // real stateless checks, so it catches everything `validateOrder`
      // cannot enumerate — and it catches it *now*, in the form, rather
      // than after the user has signed.
      //
      // Wallet-state errors are excluded. A locked or disconnected
      // extension is not a problem with the order, and pinning a blocking
      // message about it under the submit button would be misleading.
      //
      // Sequence guard: only the latest in-flight estimate is allowed to
      // pin an error — otherwise a slow first plan's rejection lands
      // after a fresh plan's success and wedges the submit button.
      if (myToken !== this._gasFeeToken) {return;}
      const described = describeTxError(e);
      const isWalletState =
        described.cancelled === true ||
        [
          'Wallet is locked',
          'No wallet detected',
          'Wallet not connected',
          // A transient RPC blip is not a verdict on the order. Pinning it as
          // a blocker would wedge the button until the user edits the form,
          // since the dry-run only re-fires on an input change.
          'Network problem',
        ].includes(described.title);

      runInAction(() => {
        // Clear the stale estimate inline rather than via `resetGasFee`,
        // which also clears `_planError` — calling it here would wipe the
        // verdict we just recorded.
        this._gasFee = EMPTY_FEE;
        this._planError = isWalletState ? undefined : described.description;
      });
      return undefined;
    } finally {
      // Only the latest estimate flips `_gasFeeLoading` back to false —
      // an older estimate's finalizer landing after a fresh one started
      // would say "we're done" while a fresh estimate is still in flight,
      // re-enabling the submit button on stale headroom.
      if (myToken === this._gasFeeToken) {
        runInAction(() => {
          this._gasFeeLoading = false;
        });
      }
    }
  };

  resetGasFee() {
    runInAction(() => {
      // Only write when something actually changes — a no-op reset must
      // not notify `gasFee` / `issues` / `canSubmit` observers.
      if (this._gasFee !== EMPTY_FEE) {
        this._gasFee = EMPTY_FEE;
      }
      if (this._gasFeeLoading) {
        this._gasFeeLoading = false;
      }
      // The planner's verdict belongs to the plan that produced it. Clearing
      // the estimate without clearing the rejection would leave a stale
      // blocking message pinned under the submit button.
      if (this._planError !== undefined) {
        this._planError = undefined;
      }
    });
  }

  setFeeAsset = (x: AssetInfo) => {
    this._feeAsset = x;
  };

  setUmFeeAsset = (x: AssetInfo) => {
    this._umFeeAsset = x;
  };

  setSubAccountIndex = (x: AddressIndex) => {
    this.subAccountIndex = x;
  };

  setAddress = (x: Address) => {
    this.address = x;
  };

  get feeAsset(): AssetInfo | undefined {
    return this._feeAsset;
  }

  get gasFee(): { symbol: string; display: string } {
    return this._gasFee;
  }

  get gasFeeLoading(): boolean {
    return this._gasFeeLoading;
  }

  async setAlternativeFee(feeAssetId: AssetId) {
    const metadata = await getAssetMetadataById(feeAssetId);
    if (!metadata) {
      return;
    }

    const assetInfo = AssetInfo.fromMetadata(metadata);
    if (!assetInfo) {
      return;
    }

    // Update the order form store so that it uses this asset as the fee asset
    orderFormStore.setFeeAsset(assetInfo);
  }

  setAssets(base: AssetInfo, quote: AssetInfo, unsetInputs: boolean) {
    this._market.setAssets(base, quote, unsetInputs);
    this._limit.setAssets(base, quote, unsetInputs);
    // The RangeLP tab is retired (`form-tabs.tsx` normalizes a stored
    // 'RangeLP' to 'LP' and `RangeLiquidityOrderForm` has no importers), but
    // `rangeForm` is still read by the chart / LP-preview overlay, so the
    // store stays. Only feed it while it is actually the active form — every
    // other tick these writes just re-derived a dead plan.
    if (this._whichForm === 'RangeLP') {
      this._range.setAssets(base, quote, unsetInputs);
    }
    this._lp.setAssets(base, quote, unsetInputs);
  }

  setMarketPrice(price: number | undefined) {
    this._marketPrice = price;

    if (price) {
      if (this._whichForm === 'RangeLP') {
        this._range.marketPrice = price;
      }
      this._limit.marketPrice = price;
      this._lp.marketPrice = price;
      return;
    }

    // Undefined means "no live mid" — on a pair switch, an empty book, or
    // book fetch failure. Only `_lp` was being nulled; `_range` and
    // `_limit` kept the previous pair's mid (defaulted to 1.0 at
    // construction, then whatever the last live pair reported), so
    // RangeLP's bid/ask split (`position.ts:307`) and Limit's "Market"
    // multiplier both used the stale mid until the new pair's price
    // resolved. Zero here means "no anchor"; downstream code already
    // treats falsy marketPrice as "guard/return" in the affected paths.
    this._lp.marketPrice = null;
    if (this._whichForm === 'RangeLP') {
      this._range.marketPrice = 0;
    }
    this._limit.marketPrice = 0;
  }

  get marketPrice(): number | undefined {
    return this._marketPrice;
  }

  setWhichForm(x: WhichForm) {
    this._whichForm = x;
    // Persist client-side so the next page load lands on the same form.
    // Reads happen from useOrderFormStore via a useEffect on mount, never
    // here — keeping localStorage off the SSR path.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('veil_which_form', x);
      } catch {
        // ignore quota / private mode errors
      }
    }
  }

  setHighlight(x: boolean) {
    this.highlight = x;
    if (x) {
      setTimeout(() => {
        this.highlight = false;
      }, 3000);
    }
  }

  get whichForm(): WhichForm {
    return this._whichForm;
  }

  get marketForm() {
    return this._market;
  }

  get limitForm() {
    return this._limit;
  }

  get rangeForm() {
    return this._range;
  }

  get lpForm() {
    return this._lp;
  }

  /** The active LP-style form (RangeLP is retired; see `setAssets`). */
  private get activeLpForm(): LPFormStore | RangeOrderFormStore {
    return this._whichForm === 'RangeLP' ? this._range : this._lp;
  }

  /**
   * Whether `plan` would be defined — WITHOUT building it.
   *
   * `plan` constructs protobufs (and, for the position forms, a fresh nonce
   * per rung), so `issues` / `canSubmit` / the fingerprint reaction must not
   * read it just to test for `undefined`. Mirrors `plan`'s guards exactly.
   */
  get hasPlan(): boolean {
    if (!this.address || !this.subAccountIndex) {
      return false;
    }
    if (this._whichForm === 'Market') {
      return this._market.plan !== undefined;
    }
    if (this._whichForm === 'Limit') {
      return this._limit.hasPlan;
    }
    return this.activeLpForm.rungs !== undefined;
  }

  /**
   * Structural shape of the transaction `plan` would produce — how many
   * position opens and swaps — derived from the cheap getters. Undefined
   * when there is no plan.
   */
  get planShape(): undefined | { opens: number; swaps: number } {
    if (!this.hasPlan) {
      return undefined;
    }
    if (this._whichForm === 'Market') {
      return { opens: 0, swaps: 1 };
    }
    if (this._whichForm === 'Limit') {
      return { opens: 1, swaps: 0 };
    }
    return { opens: this.activeLpForm.rungs?.length ?? 0, swaps: 0 };
  }

  /**
   * The transaction to plan. Expensive: builds the protos and, for the
   * position forms, draws a nonce per rung. Only `estimateGasFee` (the
   * dry-run) and `submit` (the broadcast) should read it — everything else
   * wants `hasPlan` / `planShape` / the forms' `rungs`. Pure: no side
   * effects on store state.
   */
  get plan(): undefined | TransactionPlannerRequest {
    if (!this.address || !this.subAccountIndex) {
      return undefined;
    }
    if (this._whichForm === 'Market') {
      const plan = this._market.plan;
      if (!plan) {
        return undefined;
      }
      return new TransactionPlannerRequest({
        swaps: [{ targetAsset: plan.targetAsset, value: plan.value, claimAddress: this.address }],
        source: this.subAccountIndex,
      });
    }
    if (this._whichForm === 'Limit') {
      const plan = this._limit.plan;
      if (!plan) {
        return undefined;
      }
      return new TransactionPlannerRequest({
        positionOpens: [
          { position: plan.position, positionMeta: { strategy: encodeLiquidityShape(plan.shape) } },
        ],
        source: this.subAccountIndex,
      });
    }

    const plan = this.activeLpForm.plan;
    if (!plan) {
      return undefined;
    }
    const LpPlan = new TransactionPlannerRequest({
      positionOpens: plan.map(x => ({
        position: x.position,
        positionMeta: { strategy: encodeLiquidityShape(x.shape) },
      })),
      source: this.subAccountIndex,
    });

    return LpPlan;
  }

  /**
   * What the currently-configured order will actually spend, per asset.
   *
   * For the LP forms this is read off the built positions rather than the raw
   * inputs, so it reflects rounding and any rungs the planner dropped.
   */
  get requirements(): Requirement[] {
    if (this._whichForm === 'Market') {
      const form = this._market;
      const asset = form.direction === 'buy' ? form.quoteAsset : form.baseAsset;
      const amount = form.direction === 'buy' ? form.quoteInputAmount : form.baseInputAmount;
      return asset && amount ? [{ asset, amount }] : [];
    }

    if (this._whichForm === 'Limit') {
      const form = this._limit;
      const asset = form.direction === 'buy' ? form.quoteAsset : form.baseAsset;
      const amount = parseNumber(form.direction === 'buy' ? form.quoteInput : form.baseInput);
      return asset && amount ? [{ asset, amount }] : [];
    }

    const form = this.activeLpForm;
    const { baseAsset, quoteAsset } = form;
    // `rungs` carry the base-unit-quantised amounts, so this is the same
    // total the built positions would report — without building them.
    const rungs = form.rungs;
    if (!rungs || !baseAsset || !quoteAsset) {
      return [];
    }
    return rungRequirements(rungs, baseAsset, quoteAsset);
  }

  /**
   * Everything wrong with the form right now, in plain language.
   *
   * The point is to say it *before* the user signs: historically the first
   * signal that an order was unaffordable, too small, or unanchored was a
   * failed transaction and a raw error string.
   */
  get issues(): FormIssue[] {
    const isLP = this._whichForm === 'RangeLP' || this._whichForm === 'LP';
    const lpRungs = isLP ? this.activeLpForm.rungs : undefined;

    const wrongSideFunded =
      this._whichForm === 'LP' ? this._lp.wrongSideFunded : undefined;
    const offMid =
      this._whichForm === 'LP' ? this._lp.offMidWarning : undefined;

    // Range bounds are per-form. LP uses upper/lowerPrice on _lp; RangeLP
    // uses upper/lowerPrice on _range; Market and Limit have no range.
    const rangeBounds =
      this._whichForm === 'LP'
        ? { lowerPrice: this._lp.lowerPrice, upperPrice: this._lp.upperPrice }
        : this._whichForm === 'RangeLP'
          ? { lowerPrice: this._range.lowerPrice, upperPrice: this._range.upperPrice }
          : { lowerPrice: undefined, upperPrice: undefined };

    // Build direction-explicit details for the one-sided warning so
    // validator can say "you're bidding X to buy Y" rather than the
    // abstract "quoting one side of the book".
    let oneSidedDetails: undefined | {
      fundedSide: 'base' | 'quote';
      fundedAsset: AssetInfo;
      receivedAsset: AssetInfo;
      fundedAmount: number;
    };
    if (this._whichForm === 'LP' && this._lp.isOneSided && this._lp.baseAsset && this._lp.quoteAsset) {
      const fundedSide: 'base' | 'quote' = this._lp.baseLiquidity > 0 ? 'base' : 'quote';
      oneSidedDetails = {
        fundedSide,
        fundedAsset: fundedSide === 'base' ? this._lp.baseAsset : this._lp.quoteAsset,
        receivedAsset: fundedSide === 'base' ? this._lp.quoteAsset : this._lp.baseAsset,
        fundedAmount: fundedSide === 'base' ? this._lp.baseLiquidity : this._lp.quoteLiquidity,
      };
    }

    let offMidWarning: undefined | {
      kind: OffMidWarningKind;
      fundedSide: 'base' | 'quote';
      fundedAsset: AssetInfo;
      counterAsset: AssetInfo;
      midPrice: number;
    };
    // The wholly-off kinds are judged against the live mid; the straddle
    // clamp trims against the effective (reference-aware) mid, so report
    // that one for `partial-straddle` — it's the anchor the plan splits on.
    const offMidAnchor =
      offMid === 'partial-straddle'
        ? (this._lp.effectiveMarketPrice ?? undefined)
        : this._marketPrice;
    if (offMid && this._lp.baseAsset && this._lp.quoteAsset && offMidAnchor) {
      const fundedIsQuote = this._lp.quoteLiquidity > 0;
      offMidWarning = {
        kind: offMid,
        fundedSide: fundedIsQuote ? 'quote' : 'base',
        fundedAsset: fundedIsQuote ? this._lp.quoteAsset : this._lp.baseAsset,
        counterAsset: fundedIsQuote ? this._lp.baseAsset : this._lp.quoteAsset,
        midPrice: offMidAnchor,
      };
    }

    return validateOrder({
      requirements: this.requirements,
      feeAsset: this._feeAsset,
      gasFee: parseNumber(this._gasFee.display),
      hasPlan: this.hasPlan,
      // LP anchors to the reference-aware mid: a fresh pair with no book
      // but a user-typed reference price has everything it needs, and the
      // raw `_marketPrice` would wrongly block it. Other forms keep live.
      marketPrice:
        this._whichForm === 'LP'
          ? (this._lp.effectiveMarketPrice ?? undefined)
          : this._marketPrice,
      // Only LP lays positions out around the mid; RangeLP takes
      // explicit bounds and Market/Limit don't need one at all.
      requiresMarketPrice: this._whichForm === 'LP',
      positionCount: lpRungs?.length,
      isOneSided: this._whichForm === 'LP' ? this._lp.isOneSided : undefined,
      oneSidedDetails,
      wrongSide: wrongSideFunded
        ? {
            funded: wrongSideFunded,
            baseSymbol: this._lp.baseAsset?.symbol ?? 'the base asset',
            quoteSymbol: this._lp.quoteAsset?.symbol ?? 'the quote asset',
          }
        : undefined,
      offMidWarning,
      lowerPrice: rangeBounds.lowerPrice,
      upperPrice: rangeBounds.upperPrice,
    });
  }

  /**
   * The reason submit is unavailable, if there is one.
   *
   * Our own checks come first: they are phrased around the specific field to
   * change ("use at most 99.995 UM"), whereas the planner's verdict is
   * necessarily more general. The planner is the backstop for everything
   * `validateOrder` cannot enumerate.
   */
  get blockingIssue(): FormIssue | undefined {
    const known = blockingIssue(this.issues);
    if (known) {
      return known;
    }
    if (this._planError !== undefined) {
      return { severity: 'blocking', message: this._planError };
    }
    return undefined;
  }

  /**
   * What to render under the submit button: the blocker if there is one,
   * otherwise a warning worth reading before signing (a one-sided position,
   * say) that does not prevent submission.
   */
  get formNotice(): FormIssue | undefined {
    return this.blockingIssue ?? this.issues.find(i => i.severity === 'warning');
  }

  get canSubmit(): boolean {
    // Gate on `_gasFeeLoading` too — the debounced estimate is what
    // supplies the headroom check in `validateOrder`. While it's in
    // flight, `gasFee` is still the previous plan's estimate and
    // MAX-sized orders can slip past the "leaves nothing for fee"
    // clause. Better a briefly-disabled submit than "ran out of notes".
    return (
      !this._submitting &&
      !this._gasFeeLoading &&
      this.hasPlan &&
      !this.blockingIssue
    );
  }

  async submit() {
    const plan = this.plan;
    const wasSwap = this.whichForm === 'Market';
    const source = this.subAccountIndex;
    // Redundant, but makes typescript happier.
    if (!plan || !source) {
      this.resetGasFee();
      return;
    }

    runInAction(() => {
      this._submitting = true;
    });
    // Pick the pair off whichever form was just submitted so the server's
    // /api/book cache gets primed with fresh data before the client
    // invalidations refetch — otherwise the 6s SWR cache reads back the
    // pre-swap snapshot and the LP-panel mid/route-book stays stuck on
    // the old price for up to a full TTL.
    const activeForm =
      this._whichForm === 'Market'
        ? this._market
        : this._whichForm === 'Limit'
          ? this._limit
          : this._whichForm === 'RangeLP'
            ? this._range
            : this._lp;
    const pair = {
      base: activeForm.baseAsset?.symbol,
      quote: activeForm.quoteAsset?.symbol,
    };

    try {
      // Post-swap: full market-data invalidation (book, tape, candles,
      // summary, balances). Wait for prime + invalidate before firing
      // the claim so both legs see fresh state.
      const swapResult = await planBuildBroadcast(wasSwap ? 'swap' : 'positionOpen', plan);
      await updatePositionsQuery();
      await invalidateMarketDataQueries(pair);

      if (!wasSwap || !swapResult) {
        return;
      }

      // The swap is CONFIRMED on-chain. Free the trade UI immediately and clear
      // the amount inputs — so a stray double-click can't rebuild the SAME swap
      // (the one corruption this guard exists to prevent). The SwapClaim only
      // needs the wallet to have scanned the swap's block, and the wallet
      // finishes it on its own as it syncs — so it must NOT hold the submit
      // button hostage while the wallet catches up (which can be many blocks,
      // the reported bad UX). Multiple outstanding claims are fine on Penumbra,
      // so trading again meanwhile is a legitimate new intent, not corruption.
      runInAction(() => {
        this._market.setBaseInput('');
        this._market.setQuoteInput('');
        this._submitting = false;
      });

      // No claim is issued here. Zafu's `usePenumbraSwapClaim` polls
      // `unclaimedSwaps` and claims every outstanding one (5s after the popup
      // opens, then every 30s), so a claim from veil races that tick and the
      // loser is rejected with "nullifier already spent" — that is what
      // happened to swapClaim 2699d451. veil runs in a different process and
      // cannot lock against the wallet, so the only safe number of claimers
      // is one, and it is the wallet's.
      openToast({
        type: 'success',
        message: 'Swap confirmed — the wallet will finish the claim',
        description:
          'Your swap landed on-chain. Zafu claims the output automatically once it has synced the block; no action needed. You can trade again now.',
      });

      return;
    } catch (e) {
      // Every planner/build/broadcast failure now propagates here as an
      // `Error` with the mapped `described` metadata attached
      // (plan-build-broadcast rethrows with `describe` since we need
      // the shape here for the double-swap guard). Previously that
      // catch swallowed everything and returned undefined, which made
      // the whole "swap-confirmed" flow below UNREACHABLE. The
      // downstream toast is still shown by planBuildBroadcast so we
      // don't re-fire one here for the same failure.
      const attached = (e as { described?: ReturnType<typeof describeTxError> } | undefined)
        ?.described;
      const describe = attached ?? describeTxError(e);
      if (describe.txAlreadyOnChain) {
        // Wipe the amount fields so a stray double-click on submit
        // can't rebuild the same swap plan. Prices/pair stay.
        runInAction(() => {
          if (this._whichForm === 'Market') {
            this._market.setBaseInput('');
            this._market.setQuoteInput('');
          }
        });
        return;
      }
      // planBuildBroadcast already toasted the described error. We only
      // rethrow so the caller (if any) knows submit failed; we don't
      // want to reset the form's input state, so the user can adjust
      // and retry without re-entering everything.
      throw e;
    } finally {
      runInAction(() => {
        this._submitting = false;
      });
    }
  }
}

/**
 * Finds the subaccount in subAccounts where the address index matches `connectionStore.subaccount`, properly
 * handling non-1:1 mappings by iterating through address views.
 */
const findMatchingSubaccount = (subaccounts: AddressView[] | undefined, targetAccount: number) => {
  if (!subaccounts) {
    return undefined;
  }

  return subaccounts.find(subaccount => {
    const addressView = subaccount.addressView;
    if (addressView.case === 'decoded') {
      return addressView.value.index?.account === targetAccount;
    } else {
      return undefined;
    }
  });
};

function getAccountAddress(subAccounts: AddressView[] | undefined) {
  const matchedSubaccount = findMatchingSubaccount(subAccounts, connectionStore.subaccount);
  const subAccount = subAccounts ? matchedSubaccount : undefined;
  let addressIndex = undefined;
  let address = undefined;
  const addressView = subAccount?.addressView;
  if (addressView && addressView.case === 'decoded') {
    address = addressView.value.address;
    addressIndex = addressView.value.index;
  }
  return {
    address,
    addressIndex,
  };
}

const orderFormStore = new OrderFormStore();

// Exposed so other panels (chart, route book, market trades) can prefill
// the form by reaching into the singleton — keeps interactions consistent
// across desktop/lg/xl layouts where the form is in a separate column.
export const tradeFormStore = orderFormStore;

export const useOrderFormStore = () => {
  const { subaccount } = connectionStore;
  const { data: registryUM } = useStakingTokenMetadata();
  const { data: subAccounts } = useSubaccounts();
  const { address, addressIndex } = getAccountAddress(subAccounts);
  const { data: balances } = useBalances(addressIndex?.account ?? subaccount);
  const { baseAsset, quoteAsset } = usePathToMetadata();
  const { highlight } = usePathQuery();
  const { marketPrice, symbols: marketPriceSymbols } = useMarketPrice();

  // Finds a balance by given asset metadata and selected sub-account
  const balanceFinder = useCallback(
    (asset: Metadata, balance: BalancesResponse): boolean => {
      const metadata = getMetadataFromBalancesResponse.optional(balance);
      const address = getAddressIndex.optional(balance);
      if (!metadata || !address || !addressIndex) {
        return false;
      }

      return isMetadataEqual(metadata, asset) && addressIndex.account === address.account;
    },
    [addressIndex],
  );

  // if the page sets query param `highlight`, set correct tab and highlight it for 3 seconds
  useEffect(() => {
    if (highlight === 'liquidity') {
      orderFormStore.setWhichForm('LP');
      orderFormStore.setHighlight(true);
    }
  }, [highlight]);

  useEffect(() => {
    if (
      baseAsset?.symbol &&
      baseAsset.penumbraAssetId &&
      quoteAsset?.symbol &&
      quoteAsset.penumbraAssetId
    ) {
      const baseBalance = getAmount.optional(balances?.find(balanceFinder.bind(null, baseAsset)));
      const quoteBalance = getAmount.optional(balances?.find(balanceFinder.bind(null, quoteAsset)));

      const baseAssetInfo = AssetInfo.fromMetadata(baseAsset, baseBalance);
      const quoteAssetInfo = AssetInfo.fromMetadata(quoteAsset, quoteBalance);

      const storeMapping = {
        Market: orderFormStore.marketForm,
        Limit: orderFormStore.limitForm,
        RangeLP: orderFormStore.rangeForm,
        LP: orderFormStore.lpForm,
      };
      const childStore = storeMapping[orderFormStore.whichForm];
      const prevBaseAssetInfo = childStore.baseAsset;
      const prevQuoteAssetInfo = childStore.quoteAsset;

      const isChangingAssetPair = !!(
        prevBaseAssetInfo?.symbol &&
        prevQuoteAssetInfo?.symbol &&
        (prevBaseAssetInfo.symbol !== baseAssetInfo?.symbol ||
          prevQuoteAssetInfo.symbol !== quoteAssetInfo?.symbol)
      );

      if (baseAssetInfo && quoteAssetInfo) {
        // `balances` refetches every block, so this effect fires per block
        // with freshly-minted AssetInfo objects even when nothing the form
        // cares about moved. Pushing them through `setAssets` regardless
        // notified every `baseAsset` / `quoteAsset` observer and rebuilt
        // the LP ladder for no visible change. Every child form receives
        // the same pair from `setAssets`, so the active one is
        // representative: bail unless a symbol or a balance really differs.
        const unchanged =
          !isChangingAssetPair &&
          prevBaseAssetInfo?.symbol === baseAssetInfo.symbol &&
          prevBaseAssetInfo.balance === baseAssetInfo.balance &&
          prevQuoteAssetInfo?.symbol === quoteAssetInfo.symbol &&
          prevQuoteAssetInfo.balance === quoteAssetInfo.balance;
        if (!unchanged) {
          orderFormStore.setAssets(baseAssetInfo, quoteAssetInfo, isChangingAssetPair);
        }
      }
    }
  }, [baseAsset, quoteAsset, balances, balanceFinder]);

  useEffect(() => {
    if (address && addressIndex) {
      orderFormStore.setSubAccountIndex(addressIndex);
      orderFormStore.setAddress(address);

      const umAsset = AssetInfo.fromMetadata(registryUM);

      if (umAsset) {
        orderFormStore.setUmFeeAsset(umAsset);
        if (orderFormStore.feeAsset?.symbol !== umAsset.symbol) {
          orderFormStore.setFeeAsset(umAsset);
          orderFormStore.resetGasFee();
        }
      }
    }
  }, [address, addressIndex, registryUM]);

  useEffect(() => {
    if (
      marketPrice &&
      marketPriceSymbols.base === baseAsset?.symbol &&
      marketPriceSymbols.quote === quoteAsset?.symbol
    ) {
      orderFormStore.setMarketPrice(marketPrice);
    } else {
      orderFormStore.setMarketPrice(undefined);
    }
  }, [marketPrice, marketPriceSymbols, baseAsset?.symbol, quoteAsset?.symbol]);

  return orderFormStore;
};

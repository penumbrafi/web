import { useCallback, useEffect } from 'react';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
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
import { getSwapCommitmentFromTx } from '@penumbra-zone/getters/transaction';
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
import { SimpleLPFormStore } from './SimpleLPFormStore';
import { encodeLiquidityShape } from '@/shared/math/position';
import {
  blockingIssue,
  positionRequirements,
  validateOrder,
  type FormIssue,
  type Requirement,
} from './validate';
import { parseNumber } from '@/shared/utils/num';

export type WhichForm = 'Market' | 'Limit' | 'RangeLP' | 'SimpleLP';

export const isWhichForm = (x: string): x is WhichForm => {
  return x === 'Market' || x === 'Limit' || x === 'RangeLP' || x === 'SimpleLP';
};

const GAS_DEBOUNCE_MS = 320;

export class OrderFormStore {
  private _market = new MarketOrderFormStore();
  private _limit = new LimitOrderFormStore();
  private _range = new RangeOrderFormStore();
  private _simpleLP = new SimpleLPFormStore();
  private _whichForm: WhichForm = 'Market';
  private _submitting = false;
  private _marketPrice: number | undefined = undefined;
  address?: Address;
  subAccountIndex?: AddressIndex;
  private _feeAsset?: AssetInfo;
  private _gasFee: { symbol: string; display: string } = { symbol: 'UM', display: '--' };
  private _gasFeeLoading = false;
  /** The planner's own rejection of the current form, if it has one. */
  private _planError?: string;
  defaultDecimals = 6;
  highlight = false;

  constructor() {
    makeAutoObservable(this);

    // Watch a structural fingerprint, not `this.plan`'s reference. The
    // plan getter rebuilds a fresh array on every mid-price tick (because
    // the per-position price split shifts when mid moves) but the
    // wire-level gas cost is ~ proportional to the *number* of
    // positions and the active form, not where each rung sits. The old
    // form fired planTransaction every block on a populated LP form
    // for an estimate that almost never changed; the new fingerprint
    // fires only when the shape of the transaction actually shifts.
    reaction(
      () => {
        const p = this.plan;
        if (!p) return `none|${this._whichForm}|${this.inputFingerprint}`;
        // positionOpens is the LP path, swaps is the Market path,
        // swapClaims/positionCloses for the close/withdraw flows. Sum
        // gives a stable structural count that doesn't shift on per-
        // tick price re-allocation.
        const opens = p.positionOpens?.length ?? 0;
        const swaps = p.swaps?.length ?? 0;
        // The amounts the user typed are folded in as well, because this
        // call is no longer only a gas estimate — it is also the planner
        // dry-run that catches whatever `validateOrder` cannot enumerate,
        // and *that* has to re-run when the size changes even though the
        // transaction's shape does not. Mid-price ticks are still excluded,
        // so a populated LP form does not re-plan every block.
        return `${opens}/${swaps}|${this._whichForm}|${this.inputFingerprint}`;
      },
      debounce(() => void this.estimateGasFee(), GAS_DEBOUNCE_MS),
    );
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
      case 'SimpleLP':
        return `${this._simpleLP.baseInput}|${this._simpleLP.quoteInput}|${this._simpleLP.lowerPriceInput}|${this._simpleLP.upperPriceInput}|${this._simpleLP.feeTierPercentInput}`;
    }
  }

  private estimateGasFee = async (): Promise<void> => {
    if (!this.plan) {
      this.resetGasFee();
      return;
    }

    runInAction(() => {
      this._gasFeeLoading = true;
      this._planError = undefined;
    });
    try {
      const res = await planTransaction(this.plan);
      const fee = res.transactionParameters?.fee;
      if (!fee) {
        this.resetGasFee();
        return;
      }
      await runInAction(async () => {
        // If the fee asset is the staking token, do nothing since it’s already handled in the useEffect
        // below. Otherwise, set the fee to an alternative asset.
        const feeAssetId = res.transactionParameters?.fee?.assetId;
        if (feeAssetId) {
          await this.setAlternativeFee(feeAssetId);
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
        this._gasFee = { symbol: 'UM', display: '--' };
        this._planError = isWalletState ? undefined : described.description;
      });
      return undefined;
    } finally {
      runInAction(() => {
        this._gasFeeLoading = false;
      });
    }
  };

  resetGasFee() {
    runInAction(() => {
      this._gasFee = { symbol: 'UM', display: '--' };
      this._gasFeeLoading = false;
      // The planner's verdict belongs to the plan that produced it. Clearing
      // the estimate without clearing the rejection would leave a stale
      // blocking message pinned under the submit button.
      this._planError = undefined;
    });
  }

  setFeeAsset = (x: AssetInfo) => {
    this._feeAsset = x;
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
    this._range.setAssets(base, quote, unsetInputs);
    this._simpleLP.setAssets(base, quote, unsetInputs);
  }

  setMarketPrice(price: number | undefined) {
    this._marketPrice = price;

    if (price) {
      this._range.marketPrice = price;
      this._limit.marketPrice = price;
      this._simpleLP.marketPrice = price;
    }

    // explicitly set to null to reset the lp price sliders
    if (price === undefined) {
      this._simpleLP.marketPrice = null;
    }
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

  get simpleLPForm() {
    return this._simpleLP;
  }

  get plan(): undefined | TransactionPlannerRequest {
    if (!this.address || !this.subAccountIndex) {
      return undefined;
    }
    if (this._whichForm === 'Market') {
      const plan = this._market.plan;
      if (!plan) {
        this.resetGasFee();
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
        this.resetGasFee();
        return undefined;
      }
      return new TransactionPlannerRequest({
        positionOpens: [
          { position: plan.position, positionMeta: { strategy: encodeLiquidityShape(plan.shape) } },
        ],
        source: this.subAccountIndex,
      });
    }

    const plan = this._whichForm === 'RangeLP' ? this._range.plan : this._simpleLP.plan;
    if (!plan) {
      this.resetGasFee();
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

    const form = this._whichForm === 'RangeLP' ? this._range : this._simpleLP;
    const { baseAsset, quoteAsset } = form;
    const plan = form.plan;
    if (!plan || !baseAsset || !quoteAsset) {
      return [];
    }
    return positionRequirements(
      plan.map(p => p.position),
      baseAsset,
      quoteAsset,
    );
  }

  /**
   * Everything wrong with the form right now, in plain language.
   *
   * The point is to say it *before* the user signs: historically the first
   * signal that an order was unaffordable, too small, or unanchored was a
   * failed transaction and a raw error string.
   */
  get issues(): FormIssue[] {
    const isLP = this._whichForm === 'RangeLP' || this._whichForm === 'SimpleLP';
    const lpPlan = isLP
      ? (this._whichForm === 'RangeLP' ? this._range : this._simpleLP).plan
      : undefined;

    const wrongSideFunded =
      this._whichForm === 'SimpleLP' ? this._simpleLP.wrongSideFunded : undefined;

    return validateOrder({
      requirements: this.requirements,
      feeAsset: this._feeAsset,
      gasFee: parseNumber(this._gasFee.display),
      hasPlan: this.plan !== undefined,
      marketPrice: this._marketPrice,
      // Only SimpleLP lays positions out around the live mid; RangeLP takes
      // explicit bounds and Market/Limit don't need one at all.
      requiresMarketPrice: this._whichForm === 'SimpleLP',
      positionCount: lpPlan?.length,
      isOneSided: this._whichForm === 'SimpleLP' ? this._simpleLP.isOneSided : undefined,
      wrongSide: wrongSideFunded
        ? {
            funded: wrongSideFunded,
            baseSymbol: this._simpleLP.baseAsset?.symbol ?? 'the base asset',
            quoteSymbol: this._simpleLP.quoteAsset?.symbol ?? 'the quote asset',
          }
        : undefined,
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
    return !this._submitting && this.plan !== undefined && !this.blockingIssue;
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
    try {
      const tx = await planBuildBroadcast(wasSwap ? 'swap' : 'positionOpen', plan);
      await updatePositionsQuery();

      if (!wasSwap || !tx) {
        return;
      }
      const swapCommitment = getSwapCommitmentFromTx(tx);
      const req = new TransactionPlannerRequest({
        swapClaims: [{ swapCommitment }],
        source,
      });
      await planBuildBroadcast('swapClaim', req, { skipAuth: true });
      await updatePositionsQuery();
    } catch (e) {
      // `planBuildBroadcast` already reports every planner/build/broadcast
      // failure through `describeTxError`, so anything landing here is from
      // the surrounding bookkeeping (e.g. refreshing the positions query).
      // The old handler re-reported those with `message: e.name,
      // description: e.message` — which is precisely the raw
      // "ConnectError: [invalid_argument] …" text we are trying to stop
      // showing — and double-toasted the insufficient-funds case. It also
      // matched on "insufficient funds", a string the view service never
      // emits; the real one is "ran out of notes to spend while planning
      // transaction", now mapped centrally.
      //
      // Form state is deliberately left untouched so the user can adjust
      // and retry without re-entering everything.
      const { title, description } = describeTxError(e);
      openToast({ type: 'error', message: title, description });
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
      orderFormStore.setWhichForm('SimpleLP');
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
        SimpleLP: orderFormStore.simpleLPForm,
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
        orderFormStore.setAssets(baseAssetInfo, quoteAssetInfo, isChangingAssetPair);
      }
    }
  }, [baseAsset, quoteAsset, balances, balanceFinder]);

  useEffect(() => {
    if (address && addressIndex) {
      orderFormStore.setSubAccountIndex(addressIndex);
      orderFormStore.setAddress(address);

      const umAsset = AssetInfo.fromMetadata(registryUM);

      if (umAsset && orderFormStore.feeAsset?.symbol !== umAsset.symbol) {
        orderFormStore.setFeeAsset(umAsset);
        orderFormStore.resetGasFee();
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

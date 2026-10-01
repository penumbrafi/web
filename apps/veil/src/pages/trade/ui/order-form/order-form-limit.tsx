import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { round } from '@penumbra-zone/types/round';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useBook } from '../../api/book';
import { TICK_ARROW, TICK_TEXT_COLOR, useTickDirection } from '../../model/use-tick-direction';
import { OrderInput } from './order-input';
import { SegmentedControl } from './segmented-control';
import { SelectGroup } from './select-group';
import { OrderFormStore } from './store/OrderFormStore';
import { BuyLimitOrderOptions, SellLimitOrderOptions } from './store/LimitOrderFormStore';
import { ConfirmInfoRow, ConfirmOrderModal, ConfirmWarning } from './confirm-order-modal';
import { FormIssueNotice } from './form-issue';

// Module-scoped — Object.values() of an enum allocates a fresh array on
// every call, defeating any prop-identity-based skipping in SelectGroup.
// Same idiom as the form-tabs / history-tabs / trades-tabs hoists.
const BUY_PRICE_OPTIONS = Object.values(BuyLimitOrderOptions);
const SELL_PRICE_OPTIONS = Object.values(SellLimitOrderOptions);

interface BalanceSliderProps {
  inputValue: string;
  balance?: number;
  balanceDisplay?: string;
  onSetFraction: (fraction: number) => void;
}

// Balance slider — a native range input paired with a small editable
// percent field, same pattern as the LP form's fee slider (see
// order-form-liquidity.tsx) and the Market form's balance slider. Drives
// whichever amount field is bounded by a wallet balance (quote on a buy,
// base on a sell); the other side follows automatically via the store's
// price-linked inputs.
const BalanceSlider = observer(
  ({ inputValue, balance, balanceDisplay, onSetFraction }: BalanceSliderProps) => {
    const rawPct =
      inputValue && balance ? Math.round((Number(inputValue) / Number(balance)) * 100) : 0;
    const clampedPct = Math.min(100, Math.max(0, Number.isFinite(rawPct) ? rawPct : 0));

    const [pctInput, setPctInput] = useState(String(clampedPct));
    useEffect(() => {
      setPctInput(String(clampedPct));
    }, [clampedPct]);

    return (
      <div>
        <div className='mb-1 flex items-center justify-between gap-2 leading-none'>
          <Text small color='text.secondary'>
            Available Balance
          </Text>
          <button type='button' onClick={() => onSetFraction(1.0)}>
            <Text small color='text.primary'>
              {balanceDisplay ?? '--'}
            </Text>
          </button>
        </div>
        <div className='flex items-center gap-2'>
          <input
            type='range'
            min={0}
            max={100}
            step={1}
            value={clampedPct}
            disabled={!balance}
            onChange={e => onSetFraction(Number(e.target.value) / 100)}
            aria-label='Percent of available balance'
            className='w-full cursor-pointer accent-primary-main disabled:cursor-not-allowed disabled:opacity-40'
          />
          <div className='flex shrink-0 items-baseline gap-1'>
            <input
              type='text'
              inputMode='decimal'
              value={pctInput}
              disabled={!balance}
              onChange={e => setPctInput(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => {
                const n = Math.min(100, Math.max(0, parseFloat(pctInput) || 0));
                onSetFraction(n / 100);
                setPctInput(String(Math.round(n)));
              }}
              aria-label='Percent of available balance input'
              className='h-6 w-11 rounded-sm bg-other-tonal-fill5 px-1 text-right text-xs text-text-primary tabular-nums outline-none focus:ring-1 focus:ring-primary-main disabled:cursor-not-allowed disabled:opacity-40'
            />
            <span className='text-xs text-text-secondary'>%</span>
          </div>
        </div>
      </div>
    );
  },
);

export const LimitOrderForm = observer(({ parentStore }: { parentStore: OrderFormStore }) => {
  const { connected } = connectionStore;
  const { defaultDecimals, limitForm: store } = parentStore;
  const midDirection = useTickDirection(parentStore.marketPrice);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The split walks the very route book the ladder renders. Pushed into the
  // store rather than read there, matching how the mid price gets in — and
  // only when the arrays' identity actually moves, since the book refetches
  // every block.
  const { data: book } = useBook();
  useEffect(() => {
    store.setBookRows(book?.multiHops.buy, book?.multiHops.sell);
  }, [store, book]);

  const isBuy = store.direction === 'buy';
  const baseSym = store.baseAsset?.symbol ?? '';
  const quoteSym = store.quoteAsset?.symbol ?? '';
  const limitPrice = parseFloat(store.priceInput);
  const mid = parentStore.marketPrice;
  const midText = mid != null ? round({ value: mid, decimals: 6 }) : null;
  const deltaPct =
    Number.isFinite(limitPrice) && limitPrice > 0 && mid && mid > 0
      ? ((limitPrice - mid) / mid) * 100
      : null;
  // What fills now against the book and what rests at the limit price.
  const split = store.split;
  const takesNow = split !== undefined && split.takeInput > 0;
  const rests = split !== undefined && split.restInput > 0;
  const inputSym = isBuy ? quoteSym : baseSym;

  // The amount field that's actually bounded by a wallet balance: what
  // you pay with on a buy, what you sell on a sell. Drives the balance
  // slider; the other side follows automatically via the store's
  // price-linked inputs.
  const drivingAsset = isBuy ? store.quoteAsset : store.baseAsset;
  const drivingInput = isBuy ? store.quoteInput : store.baseInput;
  // AssetInfo#balance is already in display units, matching what the
  // amount inputs above hold — no base-unit conversion needed here.
  const drivingBalance = drivingAsset?.balance;
  const setDrivingInput = isBuy ? store.setQuoteInput : store.setBaseInput;

  // ≈ at mid — the trader's available balance, valued at the current
  // chain mid, in the asset they'd come away with. Surfaced in the
  // confirm modal rather than inline now that the form uses a compact
  // summary line.
  const balanceAtMid = useMemo(() => {
    if (!mid || mid <= 0) {
      return undefined;
    }
    const balanceNum = isBuy ? store.quoteAsset?.balance : store.baseAsset?.balance;
    if (balanceNum === undefined || !Number.isFinite(balanceNum) || balanceNum <= 0) {
      return undefined;
    }
    const equiv = isBuy ? balanceNum / mid : balanceNum * mid;
    const equivAsset = isBuy ? store.baseAsset : store.quoteAsset;
    if (!equivAsset || !Number.isFinite(equiv)) {
      return undefined;
    }
    return equivAsset.formatDisplayAmount(equiv);
  }, [isBuy, mid, store.baseAsset, store.quoteAsset]);

  // One line saying how the order divides, right under the price.
  const splitLine = useMemo(() => {
    if (!split || !Number.isFinite(limitPrice) || limitPrice <= 0) {
      return undefined;
    }
    const at = `${round({ value: limitPrice, decimals: 6 })} ${quoteSym}`;
    const parts: string[] = [];
    if (takesNow) {
      const worst =
        split.takeWorstPrice !== undefined
          ? ` (worst ${round({ value: split.takeWorstPrice, decimals: 6 })} ${quoteSym})`
          : '';
      parts.push(
        `${round({ value: split.takeBase, decimals: 6 })} ${baseSym} fills now against the book${worst}`,
      );
    }
    if (rests) {
      parts.push(`${round({ value: split.restInput, decimals: 6 })} ${inputSym} rests at ${at}`);
    }
    return parts.join(' · ');
  }, [split, takesNow, rests, limitPrice, baseSym, quoteSym, inputSym]);

  const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
    const rows: ConfirmInfoRow[] = [];
    rows.push({
      label: 'Limit price',
      value: Number.isFinite(limitPrice) ? `${limitPrice} ${quoteSym}` : '—',
    });
    if (mid != null) {
      rows.push({
        label: 'Mid price',
        value: `${round({ value: mid, decimals: 6 })} ${quoteSym}`,
      });
    }
    if (deltaPct != null) {
      rows.push({
        label: 'Distance from mid',
        value: `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%`,
      });
    }
    if (takesNow) {
      rows.push({
        label: 'Fills now',
        value: `${round({ value: split.takeInput, decimals: 6 })} ${inputSym} → ~${round({
          value: isBuy ? split.takeBase : split.takeQuote,
          decimals: 6,
        })} ${isBuy ? baseSym : quoteSym}`,
      });
    }
    if (rests) {
      rows.push({
        label: 'Rests at limit',
        value: `${round({ value: split.restInput, decimals: 6 })} ${inputSym}`,
      });
    }
    rows.push({
      label: isBuy ? 'You pay' : 'You receive',
      value: `${store.quoteInput || '—'} ${quoteSym}`,
    });
    rows.push({
      label: isBuy ? 'You receive' : 'You sell',
      value: `${store.baseInput || '—'} ${baseSym}`,
    });
    rows.push({ label: 'Available balance', value: store.balance });
    if (balanceAtMid) {
      rows.push({ label: '≈ at mid', value: balanceAtMid });
    }
    rows.push({ label: 'Trading fee', value: 'Free', valueColor: 'success' });
    rows.push({
      label: 'Gas fee',
      value: `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`,
    });
    return rows;
  }, [
    limitPrice,
    mid,
    deltaPct,
    split,
    takesNow,
    rests,
    inputSym,
    isBuy,
    baseSym,
    quoteSym,
    store.baseInput,
    store.quoteInput,
    store.balance,
    balanceAtMid,
    parentStore.gasFee.display,
    parentStore.gasFee.symbol,
  ]);

  const confirmWarnings = useMemo<ConfirmWarning[]>(() => {
    const warnings: ConfirmWarning[] = [];
    if (takesNow) {
      warnings.push({
        key: 'take-not-onchain',
        message:
          'The part that fills now is a swap at the batch auction’s clearing price. It is sized so it stops at your limit for the book you can see, but nothing on-chain caps it if the book moves before this lands. The resting part never trades worse than your limit.',
      });
    }
    return warnings;
  }, [takesNow]);

  const actionLabel = useMemo(() => {
    if (!Number.isFinite(limitPrice) || limitPrice <= 0 || !store.baseInput) {
      return `${isBuy ? 'Buy' : 'Sell'} ${baseSym} as a limit order`;
    }
    const at = `${round({ value: limitPrice, decimals: 6 })} ${quoteSym}`;
    return `${isBuy ? 'Buy' : 'Sell'} ${store.baseInput} ${baseSym} at ${isBuy ? 'up to' : 'at least'} ${at}`;
  }, [isBuy, baseSym, quoteSym, limitPrice, store.baseInput]);

  // A limit order on Penumbra is a one-sided liquidity position that closes
  // when filled — not an order sitting in a matching engine. Saying so, along
  // with what is spent and what comes back, is the difference between the
  // user trusting the form and hoping it does the right thing. (Requested
  // upstream in penumbra-zone/web#2551: "would be also great addition to have
  // a humanreadable tab to understand what the actual tx impact is".)
  const subLabel = useMemo(() => {
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      return undefined;
    }
    const spend = isBuy
      ? `${store.quoteInput || '—'} ${quoteSym}`
      : `${store.baseInput || '—'} ${baseSym}`;
    if (takesNow && rests) {
      return `You commit ${spend}. The part the book can fill at your price or better is swapped now; the rest opens a one-sided liquidity position at your price that closes automatically when filled, and can be closed until then to take it back.`;
    }
    if (takesNow) {
      return `You spend ${spend} now, against the book — the whole order fills at your price or better, so nothing rests and there is no position to close.`;
    }
    return `You commit ${spend} and trade once the market reaches your price. This opens a single one-sided liquidity position that closes automatically when filled; until then you can close it and take the ${spend} back.`;
  }, [isBuy, baseSym, quoteSym, limitPrice, store.baseInput, store.quoteInput, takesNow, rests]);

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const handleConfirm = useCallback(() => {
    setConfirmOpen(false);
    void parentStore.submit();
  }, [parentStore]);

  // Compact one-line summary — replaces the old InfoRow stack (Trading
  // Fee / Gas Fee / Distance from mid / Receive). Full detail still lives
  // in the pre-submit confirm modal via confirmRows above.
  const summaryLine = useMemo(() => {
    const parts: string[] = ['Fee free'];
    if (deltaPct != null) {
      parts.push(`Δ mid ${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%`);
    }
    parts.push(
      `gas ${parentStore.gasFeeLoading ? '…' : `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`}`,
    );
    return parts.join(' · ');
  }, [
    deltaPct,
    parentStore.gasFeeLoading,
    parentStore.gasFee.display,
    parentStore.gasFee.symbol,
  ]);

  return (
    <div className='flex flex-col p-3'>
      <SegmentedControl direction={store.direction} setDirection={store.setDirection} />
      <div className='mb-2'>
        {/* Live mid-price chip above the price input — saves the trader
            from scanning the chart label or the bottom rate row to find
            the chain's current mid before deciding on a limit. Click =
            snap-to-mid (mirrors the 'Market' chip below, but right where
            the eye lands when entering a price). Tick-direction-coloured
            so the same number flashes the same colour everywhere. */}
        {midText && (
          <div className='mb-1 flex justify-end'>
            <button
              type='button'
              onClick={() => store.setPriceInput(midText)}
              title='Click to snap limit price to current chain mid'
              className='cursor-pointer rounded-sm px-1.5 py-0.5 text-xs tabular-nums hover:bg-action-hover-overlay'
            >
              <Text detail color='text.secondary'>
                Mid:{' '}
              </Text>
              <Text detail color={TICK_TEXT_COLOR[midDirection]}>
                {TICK_ARROW[midDirection]}
                {midText}
              </Text>
            </button>
          </div>
        )}
        <div className='mb-2'>
          <OrderInput
            round
            label={`${isBuy ? 'Buy' : 'Sell'} ${store.baseAsset?.symbol} at`}
            value={store.priceInput}
            placeholder={midText ?? undefined}
            decimals={store.quoteAsset?.exponent ?? defaultDecimals}
            // Pass the bound MobX setter directly, not an inline wrapper —
            // OrderInput is memo'd, so a fresh onChange identity each render
            // would defeat the memo on the *other* inputs in this form (the
            // ones whose value didn't change). The cast widens the setter
            // signature (which has an optional `fromOption` second arg) to
            // OrderInput's onChange contract; only the first arg is ever
            // passed at runtime, so `fromOption` defaults to false — same
            // behaviour the old `price => setPriceInput(price)` wrapper had.
            onChange={store.setPriceInput as (amount: string, ...args: unknown[]) => void}
            denominator={store.quoteAsset?.symbol}
          />
        </div>
        <SelectGroup<BuyLimitOrderOptions | SellLimitOrderOptions>
          options={isBuy ? BUY_PRICE_OPTIONS : SELL_PRICE_OPTIONS}
          value={store.priceInputOption}
          onChange={store.setPriceInputOption}
        />
        {splitLine && (
          <div className='mb-2 rounded-sm bg-other-tonal-fill5 px-2 py-1 text-[11px] leading-tight text-text-secondary'>
            {splitLine}
          </div>
        )}
      </div>
      <div className='mb-2'>
        <OrderInput
          round
          label={isBuy ? 'Buy' : 'Sell'}
          value={store.baseInput}
          decimals={store.baseAsset?.exponent ?? defaultDecimals}
          onChange={store.setBaseInput}
          denominator={store.baseAsset?.symbol}
        />
      </div>
      <div className='mb-2'>
        <OrderInput
          round
          label={isBuy ? 'Pay with' : 'Receive'}
          value={store.quoteInput}
          decimals={store.quoteAsset?.exponent ?? defaultDecimals}
          onChange={store.setQuoteInput}
          denominator={store.quoteAsset?.symbol}
        />
      </div>
      <div className='mb-2'>
        <BalanceSlider
          inputValue={drivingInput}
          balance={drivingBalance}
          balanceDisplay={store.balance}
          onSetFraction={fraction => {
            if (drivingBalance === undefined) {
              return;
            }
            setDrivingInput((fraction * drivingBalance).toString());
          }}
        />
      </div>

      {/* Compact summary line — one tight line replaces the InfoRow stack.
          Full detail (limit price, mid, balances, gas) still in the
          confirm modal. */}
      <div className='mb-2 text-[11px] leading-tight text-text-secondary'>{summaryLine}</div>

      {parentStore.marketPrice && (
        <div className='mb-2 flex justify-center'>
          <Text small color='text.secondary'>
            1 {store.baseAsset?.symbol} ={' '}
            <Text small color='text.primary'>
              {store.quoteAsset?.formatDisplayAmount(parentStore.marketPrice)}
            </Text>
          </Text>
        </div>
      )}

      {/* Submit — sticky so it never leaves the fold, same treatment as
          the LP form. */}
      <div className='sticky bottom-0 -mx-3 -mb-3 border-t border-other-tonal-stroke bg-base-black/95 px-3 pt-2 pb-3 backdrop-blur-sm'>
        {connected ? (
          <Button actionType='accent' disabled={!parentStore.canSubmit} onClick={openConfirm}>
            {isBuy ? 'Buy' : 'Sell'} {store.baseAsset?.symbol}
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
        confirmLabel={`${isBuy ? 'Buy' : 'Sell'} ${baseSym}`}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
});

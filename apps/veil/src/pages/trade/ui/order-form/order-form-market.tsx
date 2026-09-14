import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { round } from '@penumbra-zone/types/round';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { useMarketPrice } from '../../model/useMarketPrice';
import { OrderInput } from './order-input';
import { SegmentedControl } from './segmented-control';
import { OrderFormStore } from './store/OrderFormStore';
import { ConfirmInfoRow, ConfirmOrderModal } from './confirm-order-modal';
import { FormIssueNotice } from './form-issue';

interface SliderProps {
  inputValue: string;
  balance?: number;
  balanceDisplay?: string;
  setBalanceFraction: (fraction: number) => void;
}

// Balance slider — a native range input paired with a small editable
// percent field, same pattern as the LP form's fee slider (see
// order-form-liquidity.tsx). Either control can drive the underlying
// fraction and both stay in sync because they're both derived from the
// same store-backed input/balance pair.
const Slider = observer(
  ({ inputValue, balance, balanceDisplay, setBalanceFraction }: SliderProps) => {
    const rawPct =
      inputValue && balance ? Math.round((Number(inputValue) / Number(balance)) * 100) : 0;
    const clampedPct = Math.min(100, Math.max(0, Number.isFinite(rawPct) ? rawPct : 0));

    const [pctInput, setPctInput] = useState(String(clampedPct));
    // Keep the editable field in sync when the fraction changes from
    // elsewhere — the Max button, direction switch, or typing directly
    // into the amount field above.
    useEffect(() => {
      setPctInput(String(clampedPct));
    }, [clampedPct]);

    return (
      <div>
        <div className='mb-1 flex items-center justify-between gap-2 leading-none'>
          <Text small color='text.secondary'>
            Available Balance
          </Text>
          <button type='button' onClick={() => setBalanceFraction(1.0)}>
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
            onChange={e => setBalanceFraction(Number(e.target.value) / 100)}
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
                setBalanceFraction(n / 100);
                setPctInput(String(Math.round(n)));
              }}
              aria-label='Percent of available balance input'
              className='h-6 w-11 rounded-sm bg-other-tonal-fill5 px-1 text-right text-xs tabular-nums text-text-primary outline-none focus:ring-1 focus:ring-primary-main disabled:cursor-not-allowed disabled:opacity-40'
            />
            <span className='text-xs text-text-secondary'>%</span>
          </div>
        </div>
      </div>
    );
  },
);

export const MarketOrderForm = observer(({ parentStore }: { parentStore: OrderFormStore }) => {
  const { connected } = connectionStore;
  const { defaultDecimals, marketForm: store } = parentStore;
  // For a market order the trade clears at the touch on the relevant side
  // (buy → ask, sell → bid), not at the mid. Showing both the touch and
  // the chain mid lets the trader see, before they enter any size, exactly
  // how much spread they're paying.
  const { bestBid, bestAsk, marketPrice } = useMarketPrice();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isBuy = store.direction === 'buy';
  const touchPrice = isBuy ? bestAsk : bestBid;
  const touchLabel = isBuy ? 'Ask' : 'Bid';
  const spreadPct =
    touchPrice != null && marketPrice != null && marketPrice > 0
      ? ((touchPrice - marketPrice) / marketPrice) * 100
      : null;

  const baseSym = store.baseAsset?.symbol ?? '';
  const quoteSym = store.quoteAsset?.symbol ?? '';
  const baseAmt = store.baseInputAmount;
  const quoteAmt = store.quoteInputAmount;
  const mid = parentStore.marketPrice;

  const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
    const rows: ConfirmInfoRow[] = [];
    if (baseAmt && quoteAmt && baseAmt > 0 && quoteAmt > 0) {
      const fillPrice = quoteAmt / baseAmt;
      const decimals = fillPrice >= 1 ? 4 : fillPrice >= 0.01 ? 5 : fillPrice >= 0.0001 ? 6 : 8;
      rows.push({
        label: 'Avg fill price',
        value: `${fillPrice.toFixed(decimals)} ${quoteSym}`,
      });
      rows.push({
        label: isBuy ? 'You pay' : 'You receive',
        value: `${round({ value: quoteAmt, decimals: 6 })} ${quoteSym}`,
      });
      rows.push({
        label: isBuy ? 'You receive' : 'You sell',
        value: `${round({ value: baseAmt, decimals: 6 })} ${baseSym}`,
      });
    }
    if (mid != null) {
      rows.push({
        label: 'Mid price',
        value: `${round({ value: mid, decimals: 6 })} ${quoteSym}`,
      });
    }
    rows.push({ label: 'Trading fee', value: 'Free', valueColor: 'success' });
    if (store.priceImpact) {
      rows.push({
        label: 'Price impact',
        value: store.priceImpact,
        valueColor: (store.priceImpactPercent ?? 0) > 1 ? 'error' : undefined,
      });
    }
    if (store.unfilled) {
      rows.push({ label: 'Unfilled amount', value: store.unfilled, valueColor: 'error' });
    }
    rows.push({
      label: 'Gas fee',
      value: `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`,
    });
    return rows;
  }, [
    baseAmt,
    quoteAmt,
    baseSym,
    quoteSym,
    isBuy,
    mid,
    store.priceImpact,
    store.priceImpactPercent,
    store.unfilled,
    parentStore.gasFee.display,
    parentStore.gasFee.symbol,
  ]);

  const actionLabel = useMemo(() => {
    if (!baseAmt || baseAmt <= 0) {
      return `${isBuy ? 'Buy' : 'Sell'} ${baseSym} at market`;
    }
    const baseStr = round({ value: baseAmt, decimals: 6 });
    const quoteStr = quoteAmt ? round({ value: quoteAmt, decimals: 6 }) : null;
    return isBuy
      ? `Buy market ${baseStr} ${baseSym}${quoteStr ? ` ≈ ${quoteStr} ${quoteSym}` : ''}`
      : `Sell market ${baseStr} ${baseSym}${quoteStr ? ` ≈ ${quoteStr} ${quoteSym}` : ''}`;
  }, [baseAmt, quoteAmt, baseSym, quoteSym, isBuy]);

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const handleConfirm = useCallback(() => {
    setConfirmOpen(false);
    void parentStore.submit();
  }, [parentStore]);

  // Compact one-line summary — replaces the old InfoRow stack (Trading
  // Fee / Gas Fee / Price impact). Full detail still lives in the
  // pre-submit confirm modal via confirmRows above.
  const summaryLine = useMemo(() => {
    const parts: string[] = ['Fee free'];
    parts.push(
      `gas ${parentStore.gasFeeLoading ? '…' : `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`}`,
    );
    if (store.priceImpact) {
      parts.push(`impact ${store.priceImpact}`);
    }
    return parts.join(' · ');
  }, [
    parentStore.gasFeeLoading,
    parentStore.gasFee.display,
    parentStore.gasFee.symbol,
    store.priceImpact,
  ]);

  const highImpact = (store.priceImpactPercent ?? 0) > 1;

  return (
    <div className='flex flex-col p-3'>
      <SegmentedControl direction={store.direction} setDirection={store.setDirection} />
      {/* Pre-fill reference: the touch price the order will actually clear
          at, with how far that is from the chain's calculated mid. Reads
          green when buying off the ask is *cheaper* than mid (rare; book
          flipped), red when crossing the spread costs more than usual. */}
      {touchPrice != null && (
        <Tooltip
          message={`The current ${touchLabel.toLowerCase()} on the on-chain route book — where a ${isBuy ? 'buy' : 'sell'} market order's first lot would clear. The percentage shows how far that is from the calculated chain mid.`}
        >
          <div className='mb-2 flex items-center justify-end gap-1 text-xs tabular-nums'>
            <Text detail color='text.secondary'>
              Clears at {touchLabel}:
            </Text>
            <Text detail color='text.primary'>
              {round({ value: touchPrice, decimals: 6 })}
            </Text>
            {spreadPct != null && (
              <Text
                detail
                color={Math.abs(spreadPct) > 0.5 ? 'destructive.light' : 'text.secondary'}
              >
                ({spreadPct > 0 ? '+' : ''}
                {spreadPct.toFixed(2)}%)
              </Text>
            )}
          </div>
        </Tooltip>
      )}
      <div className='mb-2'>
        <OrderInput
          round
          value={store.baseInput}
          decimals={store.baseAsset?.exponent ?? defaultDecimals}
          label={isBuy ? 'Buy' : 'Sell'}
          onChange={store.setBaseInput}
          isEstimating={store.baseEstimating}
          isApproximately={isBuy && store.baseInputAmount !== 0}
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
          isEstimating={store.quoteEstimating}
          isApproximately={!isBuy && store.quoteInputAmount !== 0}
          denominator={store.quoteAsset?.symbol}
        />
      </div>
      <div className='mb-2'>
        <Slider
          inputValue={isBuy ? store.quoteInput : store.baseInput}
          balance={isBuy ? store.quoteBalance : store.baseBalance}
          balanceDisplay={store.balance}
          setBalanceFraction={x => store.setBalanceFraction(x)}
        />
      </div>

      {/* Compact summary line — one tight line replaces the InfoRow stack.
          Full detail (avg fill price, mid, price impact, gas) still in
          the confirm modal. */}
      <div className='mb-2 text-[11px] leading-tight text-text-secondary'>{summaryLine}</div>

      {/* Unfilled amount — the route book ran out of liquidity before
          completing the trade. Always a warning, never neutral. */}
      {store.unfilled && (
        <div className='mb-2 rounded-sm border border-destructive-light/30 bg-destructive-light/10 px-2 py-1 text-[11px] leading-tight text-destructive-light'>
          ⚠ Unfilled: {store.unfilled} — insufficient liquidity to fill the full size.
        </div>
      )}
      {/* High price impact — the trade is large enough relative to the
          book that the executed price will move noticeably from mid. */}
      {highImpact && (
        <div className='mb-2 rounded-sm border border-destructive-light/30 bg-destructive-light/10 px-2 py-1 text-[11px] leading-tight text-destructive-light'>
          ⚠ High price impact ({store.priceImpact}) — consider splitting the order or using
          Limit.
        </div>
      )}

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
      <div className='sticky bottom-0 -mx-3 -mb-3 border-t border-other-tonal-stroke bg-base-black/95 px-3 pb-3 pt-2 backdrop-blur-sm'>
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
        rows={confirmRows}
        confirmDisabled={!parentStore.canSubmit}
        confirmLabel={`${isBuy ? 'Buy' : 'Sell'} ${baseSym}`}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
});

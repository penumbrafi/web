import { useCallback, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { round } from '@penumbra-zone/types/round';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { Icon } from '@penumbra-zone/ui/Icon';
import { InfoIcon } from 'lucide-react';
import { Slider as PenumbraSlider } from '@penumbra-zone/ui/Slider';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { OrderInput } from './order-input';
import { SelectGroup } from './select-group';
import { InfoRow } from './info-row';
import { InfoRowGasFee } from './info-row-gas-fee';
import { LiquidityShape } from './liquidity-shape';
import { OrderFormStore } from './store/OrderFormStore';
import {
  MAX_POSITION_COUNT,
  MIN_POSITION_COUNT,
  UpperBoundOptions,
  LowerBoundOptions,
  FeeTierOptions,
} from './store/RangeOrderFormStore';
import { LiquidityDistributionShape } from '@/shared/math/position';
import { ConfirmInfoRow, ConfirmOrderModal, ConfirmWarning } from './confirm-order-modal';
import { FormIssueNotice } from './form-issue';

const UPPER_BOUND_OPTIONS = Object.values(UpperBoundOptions);
const LOWER_BOUND_OPTIONS = Object.values(LowerBoundOptions);
const FEE_TIER_OPTIONS = Object.values(FeeTierOptions);
const LIQUIDITY_SHAPES = Object.values(LiquidityDistributionShape);

export const RangeLiquidityOrderForm = observer(
  ({ parentStore }: { parentStore: OrderFormStore }) => {
    const { connected } = connectionStore;
    const { defaultDecimals, rangeForm: store } = parentStore;
    const [confirmOpen, setConfirmOpen] = useState(false);

    const baseSym = store.baseAsset?.symbol ?? '';
    const quoteSym = store.quoteAsset?.symbol ?? '';
    const decimals = store.quoteAsset?.exponent ?? defaultDecimals;
    const lo = store.lowerPrice;
    const hi = store.upperPrice;
    const mid = parentStore.marketPrice;
    const midText = mid != null ? round({ value: mid, decimals: 6 }) : undefined;
    const rangeCoversMid = mid != null && lo != null && hi != null && mid >= lo && mid <= hi;
    const positionCount = store.positionCount;

    const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
      const rows: ConfirmInfoRow[] = [];
      if (mid != null) {
        rows.push({
          label: 'Mid price',
          value: `${round({ value: mid, decimals: 6 })} ${quoteSym}`,
        });
      }
      if (lo != null && hi != null) {
        rows.push({
          label: 'Range',
          value: `${round({ value: lo, decimals })} → ${round({ value: hi, decimals })} ${quoteSym}`,
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
      rows.push({
        label: 'Positions',
        value: positionCount !== undefined ? String(positionCount) : '—',
      });
      rows.push({ label: 'Fee tier', value: `${store.feeTierPercentInput}%` });
      if (store.baseAssetAmount) {
        rows.push({ label: `${baseSym || 'Base'} amount`, value: store.baseAssetAmount });
      }
      if (store.quoteAssetAmount) {
        rows.push({ label: `${quoteSym || 'Quote'} amount`, value: store.quoteAssetAmount });
      }
      rows.push({
        label: 'Gas fee',
        value: `${parentStore.gasFee.display} ${parentStore.gasFee.symbol}`,
      });
      return rows;
    }, [
      mid,
      lo,
      hi,
      decimals,
      baseSym,
      quoteSym,
      positionCount,
      store.feeTierPercentInput,
      store.baseAssetAmount,
      store.quoteAssetAmount,
      parentStore.gasFee.display,
      parentStore.gasFee.symbol,
    ]);

    const confirmWarnings = useMemo<ConfirmWarning[]>(() => {
      if (mid == null || lo == null || hi == null) return [];
      if (rangeCoversMid) return [];
      const aboveMid = mid > hi;
      return [
        {
          key: 'range-warning',
          message: aboveMid
            ? "Mid above range — fully ASK side, won't fill bids until price drops in"
            : "Mid below range — fully BID side, won't fill asks until price rises in",
        },
      ];
    }, [mid, lo, hi, rangeCoversMid]);

    const actionLabel = useMemo(() => {
      const count = positionCount ?? 'Several';
      if (lo == null || hi == null) return `Open ${count} LP positions`;
      return `Open ${count} LP positions between ${round({
        value: lo,
        decimals,
      })} and ${round({ value: hi, decimals })} ${quoteSym}`;
    }, [lo, hi, decimals, quoteSym, positionCount]);

    const openConfirm = useCallback(() => setConfirmOpen(true), []);
    const closeConfirm = useCallback(() => setConfirmOpen(false), []);
    const handleConfirm = useCallback(() => {
      setConfirmOpen(false);
      void parentStore.submit();
    }, [parentStore]);

    return (
      <div className='p-4'>
        {/* Live-mid banner removed (duplicate of the 'Anchor mid'
            InfoRow at the bottom of this form). RangeLP is denser than
            SimpleLP — every extra row costs viewport, so we keep the
            mid reference to one place. */}
        <div className='mb-4'>
          <div className='mb-1'>
            <OrderInput
              round
              label='Liquidity Target'
              value={store.liquidityTargetInput}
              decimals={store.quoteAsset?.exponent ?? defaultDecimals}
              onChange={store.setLiquidityTargetInput}
              denominator={store.quoteAsset?.symbol}
            />
          </div>
          <div className='flex w-full flex-row flex-wrap items-start justify-between py-1'>
            <div className='leading-6'>
              <Text small color='text.secondary'>
                Available Balances
              </Text>
            </div>
            <div className='flex flex-col flex-wrap items-end'>
              <div>
                <Text small color='text.primary' whitespace='nowrap'>
                  {store.baseAsset?.formatBalance() ?? `-- ${store.baseAsset?.symbol}`}
                </Text>
              </div>
              <button
                type='button'
                onClick={() => {
                  const target = store.quoteAsset?.balance?.toString();
                  if (target) {
                    store.setLiquidityTargetInput(target);
                  }
                }}
              >
                <Text small color='text.primary' whitespace='nowrap'>
                  {store.quoteAsset?.formatBalance() ?? `-- ${store.quoteAsset?.symbol}`}
                </Text>
              </button>
            </div>
          </div>
        </div>
        <div className='mb-4'>
          <div className='mb-2'>
            <OrderInput
              round
              label='Upper Price Bound'
              value={store.upperPriceInput}
              placeholder={midText}
              decimals={store.quoteAsset?.exponent ?? defaultDecimals}
              // Bound MobX setter directly — OrderInput is memo'd and a
              // fresh inline wrapper would defeat the memo on the *other*
              // inputs in this form. Cast widens the setter's optional
              // `fromOption` arg to OrderInput's onChange contract;
              // OrderInput only ever passes the first arg at runtime, so
              // fromOption defaults to false (same behaviour as the old
              // `price => setUpperPriceInput(price)` wrapper).
              onChange={store.setUpperPriceInput as (amount: string, ...args: unknown[]) => void}
              denominator={store.quoteAsset?.symbol}
            />
          </div>
          <SelectGroup
            options={UPPER_BOUND_OPTIONS}
            value={store.upperPriceInputOption}
            onChange={store.setUpperPriceInputOption}
          />
        </div>
        <div className='mb-4'>
          <div className='mb-2'>
            <OrderInput
              round
              label='Lower Price Bound'
              value={store.lowerPriceInput}
              placeholder={midText}
              decimals={store.quoteAsset?.exponent ?? defaultDecimals}
              onChange={store.setLowerPriceInput as (amount: string, ...args: unknown[]) => void}
              denominator={store.quoteAsset?.symbol}
            />
          </div>
          <SelectGroup
            options={LOWER_BOUND_OPTIONS}
            value={store.lowerPriceInputOption}
            onChange={store.setLowerPriceInputOption}
          />
        </div>
        <div className='mb-4'>
          <div className='mb-2'>
            <OrderInput
              label='Fee tier'
              value={store.feeTierPercentInput}
              onChange={
                store.setFeeTierPercentInput as (amount: string, ...args: unknown[]) => void
              }
              denominator='%'
            />
          </div>
          <SelectGroup
            options={FEE_TIER_OPTIONS}
            value={store.feeTierPercentInputOption}
            onChange={store.setFeeTierPercentInputOption}
          />
        </div>
        <div className='mb-4'>
          <div className='mb-2 flex items-center gap-1'>
            <Text small color='text.secondary'>
              Liquidity Shape
            </Text>
            <Tooltip message='Choose how your liquidity is weighted across the range. Linear spreads it evenly; Concentrated stacks it near mid; Volatile pushes it to the edges.'>
              <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
            </Tooltip>
          </div>
          <div className='mb-4 flex w-full gap-2'>
            {LIQUIDITY_SHAPES.map(shape => (
              <LiquidityShape
                key={shape}
                shape={shape}
                selected={store._liquidityShape === shape}
                onSelect={store.setLiquidityShape}
              />
            ))}
          </div>
          <OrderInput
            label='Number of positions'
            value={store.positionCountInput}
            onChange={store.setPositionCountInput}
          />
          <PenumbraSlider
            min={MIN_POSITION_COUNT}
            max={MAX_POSITION_COUNT}
            step={1}
            value={store.positionCountSlider}
            showValue={false}
            onChange={store.setPositionCountSlider}
            showTrackGaps={true}
            trackGapBackground='base.black'
            showFill={true}
          />
        </div>
        <div className='mb-4'>
          {/* Same 'what's being planted' summary as SimpleLP — anchor mid
              and an endpoints-combined view of the order count, so the
              trader doesn't have to mentally re-stitch upper / lower /
              positions to picture the rung structure. */}
          {parentStore.marketPrice && (
            <InfoRow
              label='Anchor mid'
              value={`${parentStore.marketPrice.toFixed(store.quoteAsset?.exponent ?? defaultDecimals)} ${store.quoteAsset?.symbol ?? ''}`}
              toolTip='The on-chain mid the form is centred on. The shape selector above weights liquidity around this point.'
            />
          )}
          {/* Warn when the configured range doesn't include the live mid
              — a common foot-gun: traders accidentally create a one-
              sided LP that earns nothing until the market moves into
              the range. */}
          {(() => {
            const mid = parentStore.marketPrice;
            const lo = store.lowerPrice;
            const hi = store.upperPrice;
            if (mid == null || lo == null || hi == null || mid <= 0 || lo <= 0 || hi <= 0) {
              return null;
            }
            if (mid >= lo && mid <= hi) return null;
            const aboveMid = mid > hi;
            return (
              <InfoRow
                label='⚠ Range warning'
                valueColor='error'
                value={
                  aboveMid
                    ? "Mid above range — fully ASK side, won't fill bids until price drops in"
                    : "Mid below range — fully BID side, won't fill asks until price rises in"
                }
                toolTip='Your range does not include the live chain mid. A one-sided LP earns nothing in fees until the market moves into your range. Either widen the range to include mid, or accept that this is a directional bet on the market crossing your range.'
              />
            );
          })()}
          <InfoRow
            label='Orders'
            value={
              store.positionCount !== undefined &&
              store.lowerPrice !== undefined &&
              store.upperPrice !== undefined
                ? `${store.positionCount} between ${store.lowerPrice} → ${store.upperPrice}`
                : (store.positionCount ?? '—')
            }
            toolTip='Each position is a single concentrated-liquidity slot the chain matches against. The shape selector above sets per-position weights — Linear is equal across all rungs, Concentrated stacks near mid, Volatile pushes to the edges.'
          />
          <InfoRow
            label='Base asset amount'
            value={store.baseAssetAmount}
            toolTip={`The amount of ${store.baseAsset?.symbol} provided as liquidity.`}
          />
          <InfoRow
            label='Quote asset amount'
            value={store.quoteAssetAmount}
            toolTip={`The amount of ${store.quoteAsset?.symbol} provided as liquidity`}
          />
          <InfoRowGasFee
            gasFee={parentStore.gasFee.display}
            symbol={parentStore.gasFee.symbol}
            isLoading={parentStore.gasFeeLoading}
          />
        </div>
        <div className='mb-4'>
          {connected ? (
            <Button actionType='accent' disabled={!parentStore.canSubmit} onClick={openConfirm}>
              Open {store.positionCount ?? 'Several'} Positions
            </Button>
          ) : (
            <ConnectButton actionType='default' />
          )}
          {connected && <FormIssueNotice issue={parentStore.blockingIssue} />}
        </div>
        <ConfirmOrderModal
          isOpen={confirmOpen}
          actionLabel={actionLabel}
          rows={confirmRows}
          warnings={confirmWarnings}
          confirmDisabled={!parentStore.canSubmit}
          confirmLabel={`Open ${positionCount ?? 'Several'} Positions`}
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
        {parentStore.marketPrice && (
          <div className='flex justify-center p-1'>
            <Text small color='text.secondary'>
              1 {store.baseAsset?.symbol} ={' '}
              <Text small color='text.primary'>
                {store.quoteAsset?.formatDisplayAmount(parentStore.marketPrice)}
              </Text>
            </Text>
          </div>
        )}
      </div>
    );
  },
);

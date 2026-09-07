import Image from 'next/image';
import cn from 'clsx';
import { observer } from 'mobx-react-lite';
import { WalletMinimal, InfoIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { round } from '@penumbra-zone/types/round';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import { useTickDirection } from '../../model/use-tick-direction';
import { InfoRow } from './info-row';
import { InfoRowGasFee } from './info-row-gas-fee';
import { OrderFormStore } from './store/OrderFormStore';
import { DEFAULT_PRICE_RANGE, DEFAULT_PRICE_SPREAD } from './store/SimpleLPFormStore';
import { PriceSlider, roundToDecimals } from './price-slider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@penumbra-zone/ui/Icon';
import { Density } from '@penumbra-zone/ui/Density';
import { useIsLqtEligible, LQT_ENABLED } from '@/shared/utils/is-lqt-eligible';
import { LiquidityDistributionShape } from '@/shared/math/position';
import { LiquidityShape } from './liquidity-shape';
import { ConfirmInfoRow, ConfirmOrderModal, ConfirmWarning } from './confirm-order-modal';
import { FormIssueNotice } from './form-issue';

// Hoist Object.values(EnumX) to module scope — it allocates a fresh array
// per call, and the LP form re-renders every block-tick via marketPrice.
// Same idiom we use in the limit / range / form-tabs hoists.
const LIQUIDITY_SHAPES = Object.values(LiquidityDistributionShape);

export const SimpleLiquidityOrderForm = observer(
  ({ parentStore }: { parentStore: OrderFormStore }) => {
    const { connected } = connectionStore;
    const { simpleLPForm: store, defaultDecimals } = parentStore;
    const isLQTEligible = useIsLqtEligible(store.baseAsset?.metadata, store.quoteAsset?.metadata);
    // Tick-direction off the parent's marketPrice — same idiom the limit
    // form's mid-chip uses, so the colour flashes in lock step with the
    // chart label, summary 'Mid price' card and document-title ticker.
    const midDirection = useTickDirection(parentStore.marketPrice);

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

    const [confirmOpen, setConfirmOpen] = useState(false);

    const baseSym = store.baseAsset?.symbol ?? '';
    const quoteSym = store.quoteAsset?.symbol ?? '';
    const decimals = store.quoteAsset?.exponent ?? defaultDecimals;
    const lo = priceRanges[0];
    const hi = priceRanges[1];
    const mid = store.marketPrice;
    const rangeCoversMid =
      mid != null && lo !== undefined && hi !== undefined && mid >= lo && mid <= hi;

    const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
      const rows: ConfirmInfoRow[] = [];
      if (mid != null) {
        rows.push({
          label: 'Anchor mid',
          value: `${roundToDecimals(mid, decimals)} ${quoteSym}`,
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
      rows.push({ label: 'Positions', value: String(store.positions) });
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
      store.positions,
      store.baseInput,
      store.quoteInput,
      isLQTEligible,
      parentStore.gasFee.display,
      parentStore.gasFee.symbol,
    ]);

    const confirmWarnings = useMemo<ConfirmWarning[]>(() => {
      if (mid == null || lo === undefined || hi === undefined) return [];
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
      if (lo === undefined || hi === undefined) {
        return `Open ${store.positions} LP positions`;
      }
      return `Open ${store.positions} LP positions between ${roundToDecimals(
        lo,
        decimals,
      )} and ${roundToDecimals(hi, decimals)} ${quoteSym}`;
    }, [lo, hi, decimals, quoteSym, store.positions]);

    const openConfirm = useCallback(() => setConfirmOpen(true), []);
    const closeConfirm = useCallback(() => setConfirmOpen(false), []);
    const handleConfirm = useCallback(() => {
      setConfirmOpen(false);
      void parentStore.submit();
    }, [parentStore]);

    return (
      <div className='p-4'>
        {/* Live mid-price banner — anchors the form to the chain's
            current best-bid/best-ask average so the trader has the
            reference price they're centring liquidity around right at
            the top, without scanning to the chart label or summary
            card. Tick-direction-coloured to match. */}
        {parentStore.marketPrice != null && (
          <div className='mb-3 flex items-center justify-between rounded-sm border border-other-tonal-stroke px-2 py-1.5'>
            <Text detail color='text.secondary'>
              Live mid
            </Text>
            <Tooltip message='Average of best bid + best ask on the on-chain route book — the price you are centring liquidity around.'>
              <span
                className={cn(
                  'tabular-nums',
                  midDirection === 'up'
                    ? 'text-success-light'
                    : midDirection === 'down'
                      ? 'text-destructive-light'
                      : 'text-text-primary',
                )}
              >
                {midDirection === 'up' ? '▲ ' : midDirection === 'down' ? '▼ ' : ''}
                {round({ value: parentStore.marketPrice, decimals: 6 })}{' '}
                <span className='text-text-secondary'>{store.quoteAsset?.symbol ?? ''}</span>
              </span>
            </Tooltip>
          </div>
        )}
        <div className='mb-4'>
          <div className='mb-2 flex items-center gap-1 leading-6'>
            <Text small color='text.secondary'>
              Enter Amounts
            </Text>
            <Tooltip message='Specify the token amounts for your liquidity contribution. They adjust based on the selected price range.'>
              <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
            </Tooltip>
          </div>
          <div className='mb-2'>
            <Density compact>
              <TextInput
                type='number'
                typography='large'
                blurOnWheel
                value={store.baseInput}
                maxDecimals={store.quoteAsset?.exponent ?? defaultDecimals}
                onChange={store.setBaseInput}
                endAdornment={
                  store.baseAsset?.symbol && (
                    <div className='flex shrink-0 items-center gap-1 font-default text-text-sm leading-text-xs font-normal text-text-secondary'>
                      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- its necessary */}
                      {store.baseAsset?.metadata?.images?.[0]?.svg && (
                        <Image
                          className='h-4 w-4 rounded-full'
                          src={store.baseAsset.metadata.images[0].svg}
                          alt={store.baseAsset.symbol}
                          width={16}
                          height={16}
                        />
                      )}
                      <div>{store.baseAsset.symbol}</div>
                    </div>
                  )
                }
              />
            </Density>
            {store.baseAsset?.formatBalance() && (
              <button
                type='button'
                className='my-1 flex items-center gap-1 font-mono text-text-xs leading-text-xs font-normal text-text-secondary'
                onClick={() => {
                  const target = store.baseAsset?.balance?.toString();
                  if (target) {
                    store.setBaseInput(target);
                  }
                }}
              >
                <div className='flex h-[20px] w-[28px] items-center justify-center rounded-full bg-other-tonal-fill5'>
                  <Icon IconComponent={WalletMinimal} size='xs' color='text.secondary' />
                </div>
                {store.baseAsset.formatBalance()}
              </button>
            )}
          </div>
          <div className='mb-2'>
            <Density compact>
              <TextInput
                type='number'
                typography='large'
                blurOnWheel
                value={store.quoteInput}
                maxDecimals={store.quoteAsset?.exponent ?? defaultDecimals}
                onChange={store.setQuoteInput}
                endAdornment={
                  store.quoteAsset?.symbol && (
                    <div className='flex shrink-0 items-center gap-1 font-default text-text-sm leading-text-xs font-normal text-text-secondary'>
                      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- its necessary */}
                      {store.quoteAsset?.metadata?.images?.[0]?.svg && (
                        <Image
                          className='h-4 w-4 rounded-full'
                          src={store.quoteAsset.metadata.images[0].svg}
                          alt={store.quoteAsset.symbol}
                          width={16}
                          height={16}
                        />
                      )}
                      <div>{store.quoteAsset.symbol}</div>
                    </div>
                  )
                }
              />
            </Density>
            {store.quoteAsset?.formatBalance() && (
              <button
                type='button'
                className='my-1 flex items-center gap-1 font-mono text-text-xs leading-text-xs font-normal text-text-secondary'
                onClick={() => {
                  const target = store.quoteAsset?.balance?.toString();
                  if (target) {
                    store.setQuoteInput(target);
                  }
                }}
              >
                <div className='flex h-[20px] w-[28px] items-center justify-center rounded-full bg-other-tonal-fill5'>
                  <Icon IconComponent={WalletMinimal} size='xs' color='text.secondary' />
                </div>
                {store.quoteAsset.formatBalance()}
              </button>
            )}
          </div>
        </div>
        <div className='mb-4'>
          <div className='mb-2 flex items-center gap-1'>
            <Text small color='text.secondary'>
              Liquidity Shape
            </Text>
            <Tooltip message='Select how your liquidity is distributed across the price range.'>
              <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
            </Tooltip>
          </div>
          <div className='flex w-full gap-2'>
            {LIQUIDITY_SHAPES.map(shape => (
              <LiquidityShape
                key={shape}
                shape={shape}
                selected={store.liquidityShape === shape}
                onSelect={store.setLiquidityShape}
              />
            ))}
          </div>
        </div>
        <div className='mb-4'>
          <div className='mb-4 flex justify-between leading-6'>
            <div className='flex items-center gap-1'>
              <Text small color='text.secondary'>
                Price Range
              </Text>
              <Tooltip message='Defines the range of prices where your liquidity will be active. You earn fees only when trades happen within this range.'>
                <Icon IconComponent={InfoIcon} size='sm' color='text.secondary' />
              </Tooltip>
            </div>
            <div className='flex items-center gap-1'>
              <Button
                actionType='default'
                priority='secondary'
                density='slim'
                onClick={() => {
                  setZoomAdjustment(prev => Math.min(0.25, prev + 0.05));
                }}
                icon={ZoomOut}
                iconOnly
              >
                Zoom Out
              </Button>
              <Button
                actionType='default'
                priority='secondary'
                density='slim'
                onClick={() => {
                  setZoomAdjustment(prev => Math.max(-0.25, prev - 0.05));
                }}
                icon={ZoomIn}
                iconOnly
              >
                Zoom In
              </Button>
              <Button actionType='default' priority='secondary' density='slim' onClick={setRanges}>
                Reset
              </Button>
            </div>
          </div>
          <PriceSlider
            min={store.marketPrice ? store.marketPrice * (1 - adjustedPriceRange) : 0}
            max={store.marketPrice ? store.marketPrice * (1 + adjustedPriceRange) : Infinity}
            values={priceRanges}
            onInput={setPriceRanges}
            quoteExponent={store.quoteAsset?.exponent ?? defaultDecimals}
            marketPrice={store.marketPrice}
            quoteAsset={store.quoteAsset}
            baseAsset={store.baseAsset}
          />
          {/* Quick-snap range presets — saves the trader from dragging the
              slider every time they want a textbook ±X% bracket. Range LP
              has equivalent buttons; SimpleLP previously only had zoom +
              reset, so 'I want a 5% range' meant manual drag. Highlight
              the active preset (±0.1% tolerance) so the form's current
              range reads at a glance. */}
          {store.marketPrice && (
            <div className='mt-2 flex items-center gap-1'>
              <Text detail color='text.secondary'>
                Quick range
              </Text>
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
                      // Auto-zoom out so the slider can actually reach
                      // wide presets that exceed the current zoom range.
                      const needed = pct + 0.05;
                      setZoomAdjustment(prev =>
                        needed > priceRange + prev ? needed - priceRange : prev,
                      );
                    }}
                    className={cn(
                      'rounded-sm border px-2 py-0.5 text-xs tabular-nums transition-colors',
                      isActive
                        ? 'border-primary-main bg-other-tonal-fill5 text-text-primary'
                        : 'border-other-tonal-stroke text-text-secondary hover:bg-action-hover-overlay hover:text-text-primary',
                    )}
                  >
                    ±{(pct * 100).toFixed(pct < 0.01 ? 1 : 0)}%
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className='mb-4'>
          {/* Range width as a +/- % of mid — narrow ranges concentrate
              fee earnings but go out-of-range faster on a quiet pair,
              wide ranges earn less per unit of capital but stay live
              longer. Surface the trade-off inline so the trader can
              read it before submit. */}
          {(() => {
            const mid = store.marketPrice;
            const lo = priceRanges[0];
            const hi = priceRanges[1];
            if (!mid || mid <= 0 || lo === undefined || hi === undefined) {
              return null;
            }
            const lowerPct = ((mid - lo) / mid) * 100;
            const upperPct = ((hi - mid) / mid) * 100;
            // Show a single ±X.X% if symmetric, otherwise show both legs.
            const symmetric = Math.abs(lowerPct - upperPct) < 0.05;
            const value = symmetric
              ? `±${Math.abs(lowerPct).toFixed(2)}%`
              : `-${lowerPct.toFixed(2)}% / +${upperPct.toFixed(2)}%`;
            return <InfoRow label='Range width' value={value} />;
          })()}
          {/* Preview of what's about to be planted: anchor mid the form is
              centred on, total order count, and price endpoints. The chart
              overlay (LpPreviewOverlay) already renders the rungs visually
              — these rows give the same info numerically for traders who
              want exact numbers, not a band. */}
          {(() => {
            const mid = store.marketPrice;
            if (!mid) return null;
            const lo = priceRanges[0];
            const hi = priceRanges[1];
            const decimals = store.quoteAsset?.exponent ?? defaultDecimals;
            return (
              <>
                <InfoRow
                  label='Anchor mid'
                  value={`${roundToDecimals(mid, decimals)} ${store.quoteAsset?.symbol ?? ''}`}
                  toolTip='The on-chain mid the form uses to split liquidity above vs. below. Comes from the live route book.'
                />
                {lo !== undefined && hi !== undefined && (
                  <InfoRow
                    label='Orders'
                    value={`${store.positions} between ${roundToDecimals(lo, decimals)} → ${roundToDecimals(hi, decimals)}`}
                    toolTip='How many positions will be opened across the range, and the price endpoints. Each position is a single concentrated-liquidity slot the chain matches against.'
                  />
                )}
              </>
            );
          })()}
          {/* Same one-sided-LP foot-gun warning as Range LP — when the
              configured range doesn't include live mid, the LP earns
              nothing in fees until the market moves into range. */}
          {(() => {
            const mid = store.marketPrice;
            const lo = priceRanges[0];
            const hi = priceRanges[1];
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
          {LQT_ENABLED && (
            <InfoRow
              label='LQT Rewards'
              value={isLQTEligible ? 'Eligible' : 'Not Eligible'}
              valueColor={isLQTEligible ? 'success' : undefined}
              toolTip={
                isLQTEligible ? (
                  <>
                    This pair qualifies for LQT rewards. By providing liquidity, you earn additional
                    protocol incentives.{' '}
                    <a href='https://penumbra-zone.webflow.io/tournament' className='underline'>
                      Learn More.
                    </a>
                  </>
                ) : (
                  <>
                    This pair is not currently eligible for LQT rewards. Explore other pairs or{' '}
                    <a href='https://penumbra-zone.webflow.io/tournament' className='underline'>
                      Learn More.
                    </a>
                  </>
                )
              }
            />
          )}
          <InfoRowGasFee
            gasFee={parentStore.gasFee.display}
            symbol={parentStore.gasFee.symbol}
            isLoading={parentStore.gasFeeLoading}
          />
        </div>
        <div className='mb-4'>
          {connected ? (
            <Button actionType='accent' disabled={!parentStore.canSubmit} onClick={openConfirm}>
              Add Liquidity
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
          confirmLabel='Add Liquidity'
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

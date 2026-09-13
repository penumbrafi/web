import { useCallback, useEffect } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Tabs } from '@penumbra-zone/ui/Tabs';
import { Density } from '@penumbra-zone/ui/Density';
import { MarketOrderForm } from './order-form/order-form-market';
import { LimitOrderForm } from './order-form/order-form-limit';
import { SimpleLiquidityOrderForm } from './order-form/order-form-simple-liquidity';
import { isWhichForm, useOrderFormStore } from './order-form/store/OrderFormStore';
import { observer } from 'mobx-react-lite';
import cn from 'clsx';

// Top-level tabs: Market / Limit / Provide Liquidity. The advanced-only
// knobs that once lived on a separate RangeLP tab (fee tier, position
// count, shape selector) are now on the Provide Liquidity form itself,
// so one flow covers Basic and Advanced use.
const TOP_TAB_OPTIONS = [
  { value: 'Market', label: 'Market' },
  { value: 'Limit', label: 'Limit' },
  { value: 'Liquidity', label: 'Provide Liquidity' },
];

export const FormTabs = observer(() => {
  const [parent] = useAutoAnimate();
  const store = useOrderFormStore();

  // Hydrate the user's last selected form on mount. The store defaults to
  // 'Market' on SSR and on the first client render so React hydration
  // stays stable; this effect then swaps in whatever the user had open
  // last (Market / Limit / SimpleLP). Same pattern as chart timeframe
  // and chart prefs.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('veil_which_form');
      // 'RangeLP' is retired — its knobs are now on SimpleLP. Anyone
      // whose last-selected tab was Advanced lands on Basic instead.
      const normalized = raw === 'RangeLP' ? 'SimpleLP' : raw;
      if (normalized && isWhichForm(normalized) && normalized !== store.whichForm) {
        store.setWhichForm(normalized);
      }
    } catch {
      // ignore storage errors
    }
    // store is stable, only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The top-level Tabs reads 'Liquidity' as the parent option for
  // SimpleLP. RangeLP is retired but still reachable via the store's
  // last-used state; the effect above rewrites it to SimpleLP on mount.
  const isLiquidity = store.whichForm === 'SimpleLP' || store.whichForm === 'RangeLP';
  const topValue = isLiquidity ? 'Liquidity' : store.whichForm;

  const onTopTabChange = useCallback(
    (value: string) => {
      if (value === 'Liquidity') {
        if (!isLiquidity) {
          store.setWhichForm('SimpleLP');
        }
        return;
      }
      if (isWhichForm(value)) {
        store.setWhichForm(value);
      }
    },
    [store, isLiquidity],
  );

  return (
    <div
      ref={parent}
      // h-full + min-h-0 so the inner form area can flex-1 + scroll
      // internally instead of pushing the whole page longer when the
      // form (esp. RangeLP) is taller than the panel.
      className={cn(
        'flex h-full min-h-0 flex-col transition-colors duration-500',
        store.highlight && 'bg-action-hover-overlay',
      )}
    >
      <div className='border-b border-b-other-solid-stroke px-4 lg:pt-2'>
        <Density compact>
          <Tabs
            value={topValue}
            actionType='accent'
            onChange={onTopTabChange}
            options={TOP_TAB_OPTIONS}
          />
        </Density>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {store.whichForm === 'Market' && <MarketOrderForm parentStore={store} />}
        {store.whichForm === 'Limit' && <LimitOrderForm parentStore={store} />}
        {(store.whichForm === 'SimpleLP' || store.whichForm === 'RangeLP') && (
          <SimpleLiquidityOrderForm parentStore={store} />
        )}
      </div>
    </div>
  );
});

'use client';

import cn from 'clsx';
import { useViewport } from '@/shared/utils/use-viewport';
import { useLivePriceTitle } from '../model/use-live-price-title';
import { useRememberPair } from '../model/use-remember-pair';
import { ResizableSplit } from '@/shared/ui/resizable-split';
import { PairInfo } from './pair-info';
import { Chart } from './chart/chart';
import { RouteTabs } from './route-tabs';
import { TradesTabs } from './trades';
import { HistoryTabs } from './history-tabs';
import { FormTabs } from './form-tabs';

const sharedStyle = 'w-full border-t border-t-other-solid-stroke overflow-x-hidden';

// extra large grid (>1600px)
const XlLayout = () => {
  return (
    <div className={cn(sharedStyle, 'hidden h-[calc(100vh-3.5rem)] xl:block')}>
      <ResizableSplit
        anchor='right'
        defaultSize={400}
        min={260}
        max={560}
        storageKey='veil-trade-xl-form-width'
        className='h-full'
      >
        <ResizableSplit
          anchor='bottom'
          defaultSize={220}
          min={120}
          max={500}
          storageKey='veil-trade-xl-history-height'
          className='h-full'
        >
          <ResizableSplit
            anchor='right'
            defaultSize={320}
            min={240}
            max={520}
            storageKey='veil-trade-xl-routebook-width'
            className='h-full'
          >
            <div className='flex h-full flex-col'>
              <div className='border-b border-b-other-solid-stroke'>
                <PairInfo />
              </div>
              <div className='min-h-0 flex-1 border-r border-r-other-solid-stroke'>
                <Chart />
              </div>
            </div>
            <RouteTabs />
          </ResizableSplit>
          <div className='h-full overflow-auto border-t border-t-other-solid-stroke'>
            <HistoryTabs />
          </div>
        </ResizableSplit>
        <ResizableSplit
          anchor='bottom'
          defaultSize={290}
          min={120}
          max={700}
          storageKey='veil-trade-xl-trades-height'
          className='h-full border-l border-l-other-solid-stroke'
        >
          <div className='h-full overflow-auto'>
            <FormTabs />
          </div>
          <div className='h-full overflow-auto border-t border-t-other-solid-stroke'>
            <TradesTabs />
          </div>
        </ResizableSplit>
      </ResizableSplit>
    </div>
  );
};

// large grid (>1200px)
const LLayout = () => {
  return (
    <div className={cn(sharedStyle, 'hidden h-[calc(100vh-3.5rem)] lg:flex lg:flex-col xl:hidden')}>
      <div className='border-b border-b-other-solid-stroke'>
        <PairInfo />
      </div>
      <ResizableSplit
        anchor='right'
        defaultSize={400}
        min={260}
        max={560}
        storageKey='veil-trade-lg-form-width'
        className='min-h-0 flex-1'
      >
        <ResizableSplit
          anchor='bottom'
          defaultSize={200}
          min={120}
          max={500}
          storageKey='veil-trade-lg-history-height'
          className='h-full'
        >
          <ResizableSplit
            anchor='right'
            defaultSize={320}
            min={240}
            max={520}
            storageKey='veil-trade-lg-routebook-width'
            className='h-full'
          >
            <div className='h-full border-r border-r-other-solid-stroke'>
              <Chart />
            </div>
            <RouteTabs />
          </ResizableSplit>
          <div className='h-full overflow-auto border-t border-t-other-solid-stroke'>
            <HistoryTabs />
          </div>
        </ResizableSplit>
        <ResizableSplit
          anchor='bottom'
          defaultSize={272}
          min={120}
          max={700}
          storageKey='veil-trade-lg-trades-height'
          className='h-full border-l border-l-other-solid-stroke'
        >
          <div className='h-full overflow-auto'>
            <FormTabs />
          </div>
          <div className='h-full overflow-auto border-t border-t-other-solid-stroke'>
            <TradesTabs />
          </div>
        </ResizableSplit>
      </ResizableSplit>
    </div>
  );
};

// desktop grid (>900px)
const DesktopLayout = () => {
  return (
    <div
      className={cn(sharedStyle, 'hidden desktop:grid desktop:grid-cols-[1fr_1fr_320px] lg:hidden')}
    >
      <div className='col-span-3 border-r border-b border-r-other-solid-stroke border-b-other-solid-stroke'>
        <PairInfo />
      </div>
      <div className='col-span-2 flex flex-col gap-2'>
        <div className='grid grid-cols-[1fr_1fr] grid-rows-[auto_1fr]'>
          <div className='col-span-2 h-[650px] border-b border-b-other-solid-stroke'>
            <Chart />
          </div>
          <RouteTabs />
          <div className='border-l border-l-other-solid-stroke'>
            <TradesTabs />
          </div>
        </div>
      </div>
      <div className='border-l border-l-other-solid-stroke'>
        <FormTabs />
      </div>
      <div className='col-span-3 border-t border-t-other-solid-stroke'>
        <HistoryTabs />
      </div>
    </div>
  );
};

// tablet grid (600px)
const TabletLayout = () => {
  return (
    <div
      className={cn(sharedStyle, 'hidden tablet:grid tablet:grid-cols-[1fr_1fr] desktop:hidden')}
    >
      <div className='col-span-2 border-b border-b-other-solid-stroke'>
        <PairInfo />
      </div>
      <div className='col-span-2 border-b border-b-other-solid-stroke'>
        <TradesTabs withChart />
      </div>
      <RouteTabs />
      <div className='border-l border-l-other-solid-stroke'>
        <FormTabs />
      </div>
      <div className='col-span-2 border-t border-t-other-solid-stroke'>
        <HistoryTabs />
      </div>
    </div>
  );
};

// mobile grid (<600px)
const MobileLayout = () => {
  return (
    <div className={cn(sharedStyle, 'hidden mobile:grid mobile:grid-cols-[1fr] tablet:hidden')}>
      <div className='border-b border-b-other-solid-stroke'>
        <PairInfo />
      </div>
      <div className='border-b border-b-other-solid-stroke'>
        <TradesTabs withChart />
      </div>
      <div className='border-b border-b-other-solid-stroke'>
        <FormTabs />
      </div>
      <div className='border-b border-b-other-solid-stroke'>
        <RouteTabs />
      </div>
      <HistoryTabs />
    </div>
  );
};

export const TradePage = () => {
  const viewport = useViewport();
  // Tab title shows the live mid-price + pair so multi-tab traders can read
  // prices off the tab bar. Mounted once at the page root so the layout
  // re-mount on viewport change doesn't churn it.
  useLivePriceTitle();
  useRememberPair();

  return {
    mobile: <MobileLayout />,
    tablet: <TabletLayout />,
    desktop: <DesktopLayout />,
    lg: <LLayout />,
    xl: <XlLayout />,
  }[viewport];
};

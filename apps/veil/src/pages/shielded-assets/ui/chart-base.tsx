import { createChart, IChartApi, UTCTimestamp } from 'lightweight-charts';

// theme.color.text.secondary is only a CSS variable (empty in the JS
// theme), and canvas needs concrete colours.
const AXIS_TEXT = '#a3a3a3';
const GRID = '#fafafa14';

export type RangeKey = '1m' | '3m' | '1y' | 'all';
export const RANGES: { value: RangeKey; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const DAY_S = 86_400;
const RANGE_SECONDS: Record<Exclude<RangeKey, 'all'>, number> = {
  '1m': 30 * DAY_S,
  '3m': 90 * DAY_S,
  '1y': 365 * DAY_S,
};

// The dataviz reference palette's dark steps, validated against veil's
// surface; OTHER is a neutral for "everything else".
export const SERIES_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
export const OTHER_COLOR = '#5c5c5c';

export const createBaseChart = (el: HTMLElement): IChartApi =>
  createChart(el, {
    autoSize: true,
    layout: {
      textColor: AXIS_TEXT,
      background: { color: 'transparent' },
      attributionLogo: false,
    },
    grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
    // Amounts and USD values: no room below the baseline for negatives.
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0 } },
    // The price axis is zoomed by usePriceAxis, which keeps it at or above
    // 0; the chart's own axis drag would bypass that.
    handleScale: { axisPressedMouseMove: { time: true, price: false } },
    timeScale: {
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      // Long histories are many points; the default 0.5px floor would stop
      // zooming out well short of "all".
      minBarSpacing: 0.01,
    },
    crosshair: { horzLine: { visible: false, labelVisible: false } },
  });

/** Jump the time axis to a window ending at `tipMs`, or fit everything. */
export const showRange = (chart: IChartApi, key: RangeKey, tipMs: number) => {
  if (key === 'all') {
    chart.timeScale().fitContent();
    return;
  }
  const to = Math.floor(tipMs / 1000);
  chart.timeScale().setVisibleRange({
    from: (to - RANGE_SECONDS[key]) as UTCTimestamp,
    to: to as UTCTimestamp,
  });
};

export const AutoAxisButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type='button'
    onClick={onClick}
    title='Fit the price axis to what is in view again'
    className='absolute right-16 bottom-9 z-10 rounded-full border border-other-tonal-stroke bg-base-black/70 px-3 py-1 text-xs text-text-secondary backdrop-blur-sm hover:text-text-primary'
  >
    Auto
  </button>
);

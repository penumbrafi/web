import cn from 'clsx';
import { observer } from 'mobx-react-lite';
import {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import {
  RotateCcw,
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  Minus as MinusIcon,
  ShoppingCart,
  Tag,
} from 'lucide-react';
import { DurationWindow, durationWindows, isDurationWindow } from '@/shared/utils/duration.ts';
import { BlockchainError } from '@/shared/ui/blockchain-error';
import { useInfiniteCandles } from '../../api/infinite-candles';
import { useLatestCandles } from '../../api/latest-candles';
import { ChartLoadingState } from './loading-chart';
import { useChartConfig } from './use-chart-config';
import { PriceContextMenu, PriceMenuItem } from './price-context-menu';
import { tradeFormStore } from '../order-form/store/OrderFormStore';
import { DepthOverlay } from './depth-overlay';
import { MidPriceOverlay } from './mid-price-overlay';
import { LpPreviewOverlay } from './lp-preview-overlay';
import { OwnPositionsDragOverlay } from './own-positions-drag-overlay';
import { LimitPreviewOverlay } from './limit-preview-overlay';
import { useOwnPositionLines } from './use-own-position-lines';
import { useOwnFillMarkers } from './use-own-fill-markers';
import { usePathSymbols } from '../../model/use-path';
import { useDrawings } from './drawings/use-drawings';
import { DrawingToolbar } from './drawings/toolbar';
import { DrawingsOverlay } from './drawings/drawings-overlay';
import type { ToolMode } from './drawings/types';

// theme.ts exports a typing stub, so theme.color.primary.main resolves to ''
// at runtime. Use the actual hex from theme.css for SVG strokes/fills that
// need a real color value.
// Penumbra secondary.light — the teal that shows up everywhere in the
// brand (Veil header, /tokenomics, About cards). Reads cleanly on the
// candle backdrop without competing with the orange primary used on
// active form chips and resting-LP markers.
const DRAWING_COLOR = '#53aea8';
import { HoverTooltip } from './hover-tooltip';
import { useChartPrefs } from './use-chart-prefs';
import { ChartSettingsMenu } from './chart-settings-menu';
import { connectionStore } from '@/shared/model/connection';
import { useMarketPrice } from '../../model/useMarketPrice';
import { usePriceAlerts } from './alerts/use-price-alerts';
import { AlertsOverlay } from './alerts/alerts-overlay';
import { useAlertWatcher } from './alerts/use-alert-watcher';
import { AlertsMenu } from './alerts/alerts-menu';

const VOLUME_RATIO_KEY = 'veil_chart_volume_ratio';
const DURATION_KEY = 'veil_chart_duration';

const readStoredVolumeRatio = (): number => {
  if (typeof window === 'undefined') return 0.2;
  const raw = window.localStorage.getItem(VOLUME_RATIO_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0.05 && n <= 0.6 ? n : 0.2;
};

const readStoredDuration = (): DurationWindow => {
  if (typeof window === 'undefined') return '1d';
  const raw = window.localStorage.getItem(DURATION_KEY);
  return raw && isDurationWindow(raw) ? raw : '1d';
};

// Stable no-op setter shared across renders. Hoisted so we don't allocate a
// fresh function (and bust hook deps inside useOwnPositionLines /
// useOwnFillMarkers) every Chart render.
const NOOP_SETTER = (_: unknown) => {};

// Hoisted const — same identity every render, drops a fresh-literal alloc.
const CROSSHAIR_STYLE = { cursor: 'crosshair' } as const;

// Module-scoped formatter — pure, no closure deps, so there's no reason to
// allocate it inside the Chart render closure.
const formatPrice = (p: number): string => {
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toPrecision(4);
};

// One memo'd button per timeframe in the chart's top toolbar. The chart
// re-renders every block via marketPrice, and the previous map-with-
// inline-arrow pattern allocated 7 fresh `() => setDuration(w)` closures
// per render — defeated any prop-identity check downstream. With a
// stable onSelect handler from the parent, memo skips the 6 buttons
// whose active state didn't change on each user click; on block-tick
// re-renders, all 7 skip.
const DurationButton = memo(
  ({
    value,
    active,
    onSelect,
  }: {
    value: DurationWindow;
    active: boolean;
    onSelect: (d: DurationWindow) => void;
  }) => {
    const onClick = useCallback(() => onSelect(value), [onSelect, value]);
    return (
      <button
        type='button'
        className={cn(
          'flex items-center rounded px-1.5 py-3 transition-colors hover:bg-action-hover-overlay hover:text-text-primary',
          active ? 'bg-action-active-overlay text-text-primary' : 'text-text-secondary',
        )}
        onClick={onClick}
      >
        <Text detail>{value}</Text>
      </button>
    );
  },
);

DurationButton.displayName = 'DurationButton';

// Click-to-place overlay shown only while a drawing tool is active.
// Extracted + memo'd so the chart's per-block re-render doesn't drag a
// fresh inline onClick closure through reconciliation. Internally
// useCallback'd over the (already-stable) priceAtY / timeAtX / onResolve
// trio so the underlying div listener is stable for as long as it's
// mounted.
const ClickCaptureOverlay = memo(
  ({
    priceAtY,
    timeAtX,
    containerRef,
    onResolve,
    onCursorMove,
    onCursorLeave,
  }: {
    priceAtY: (y: number) => number | undefined;
    timeAtX: (x: number) => number | undefined;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onResolve: (
      point: { x: number; y: number },
      price: number,
      time: number | undefined,
    ) => void;
    /** Live cursor tracking for trend-line / rectangle preview. rAF-
     *  coalesced inside so 60-100Hz pointermove doesn't flood setState. */
    onCursorMove?: (point: { x: number; y: number }) => void;
    onCursorLeave?: () => void;
  }) => {
    const onClick = useCallback(
      (e: ReactMouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const price = priceAtY(y);
        const time = timeAtX(x);
        if (price === undefined) return;
        onResolve({ x, y }, price, time);
      },
      [priceAtY, timeAtX, containerRef, onResolve],
    );
    const rafRef = useRef(0);
    const pendingRef = useRef<{ x: number; y: number } | null>(null);
    const onMove = useCallback(
      (e: ReactMouseEvent) => {
        if (!onCursorMove) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        pendingRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const p = pendingRef.current;
          if (p) onCursorMove(p);
        });
      },
      [containerRef, onCursorMove],
    );
    const onLeave = useCallback(() => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      onCursorLeave?.();
    }, [onCursorLeave]);
    return (
      <div
        className='absolute inset-0 z-[5] cursor-crosshair'
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      />
    );
  },
);

ClickCaptureOverlay.displayName = 'ClickCaptureOverlay';

export const Chart = observer(() => {
  // Start at '1d' on SSR / first client render to keep hydration stable, then
  // hydrate from localStorage in an effect (same pattern as the volume ratio
  // and chart prefs).
  const [duration, setDurationState] = useState<DurationWindow>('1d');
  const [volumeRatio, setVolumeRatioState] = useState(0.2);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readStoredDuration();
    if (stored !== duration) setDurationState(stored);
    // duration intentionally excluded — only read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change so a tab reload lands the trader on the same
  // timeframe they were last looking at.
  const setDuration = useCallback((next: DurationWindow) => {
    setDurationState(next);
    try {
      window.localStorage.setItem(DURATION_KEY, next);
    } catch {
      // ignore storage errors (private mode, quota, etc)
    }
  }, []);

  // Prefs read up here so the candle queries below can pin to the
  // current linearTime setting (the API gap-fills server-side based
  // on it). Toggling the pref re-keys the queries and pulls fresh
  // data without tearing down the chart instance.
  const { prefs, toggle } = useChartPrefs();

  // we need two queries to avoid overfetching. if we leave only the infinite query, it will
  // be requested PAGE times on each block, causing many unnecessary requests.
  const { data: latestCandles } = useLatestCandles(duration, prefs.linearTime);
  const { data: historyCandles, isLoading, error, fetchNextPage } = useInfiniteCandles(
    duration,
    prefs.linearTime,
  );

  const isFetching = useRef(false);
  // Stabilize across renders. useChartConfig's setChartRef wires this into a
  // subscribeVisibleLogicalRangeChange callback exactly once at chart create
  // time, so any per-render fresh wrapper would silently capture stale
  // closures (it works today only because React Query's fetchNextPage
  // identity is itself stable). Pin the wrapper too so the contract is
  // explicit and not load-bearing on a library detail.
  const fetchNext = useCallback(async () => {
    isFetching.current = true;
    await fetchNextPage();
    isFetching.current = false;
  }, [fetchNextPage]);

  const {
    chartRef,
    setVolumeData,
    setCandlesData,
    updateLatestCandles,
    updateLatestVolumes,
    setVolumeRatio,
    priceAtY,
    yAtPrice,
    xAtTime,
    setOwnPositionLines,
    setOwnFillMarkers,
    chartReady,
    resetView,
    centerPriceScaleOn,
    timeAtX,
    subscribeRedraw,
    subscribeHover,
    subscribeChartClick,
    setCloseLineVisible,
  } = useChartConfig(fetchNext, isFetching);

  useEffect(() => {
    if (!chartReady) return;
    setCloseLineVisible(prefs.closeLine);
  }, [prefs.closeLine, chartReady, setCloseLineVisible]);

  // Gate per-overlay data feeds behind the user's preference. The hooks
  // still mount (so the queries they own can settle), but we hand each a
  // module-scoped no-op setter when disabled so nothing is pushed to the
  // chart and the function reference is stable across renders.
  useOwnPositionLines(
    prefs.ownPositions ? setOwnPositionLines : (NOOP_SETTER as typeof setOwnPositionLines),
  );
  useOwnFillMarkers(
    prefs.ownTrades ? setOwnFillMarkers : (NOOP_SETTER as typeof setOwnFillMarkers),
  );

  const { baseSymbol, quoteSymbol } = usePathSymbols();
  const { marketPrice, spreadPercentage } = useMarketPrice();
  const pairKey = `${baseSymbol}/${quoteSymbol}`;
  const {
    alerts: pairAlerts,
    add: addAlert,
    remove: removeAlert,
    markTriggered: markAlertTriggered,
  } = usePriceAlerts(pairKey);
  useAlertWatcher({ marketPrice, alerts: pairAlerts, onFire: markAlertTriggered });

  // Auto-center the price scale on the live chain mid — once per pair. We
  // only fire on the first finite marketPrice we see for a given pair so
  // the view doesn't lurch around every block as the mid ticks; the user's
  // subsequent pan/zoom is preserved (dragging the price axis flips
  // autoScale off, at which point the provider stops applying).
  const centeredForPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chartReady) return;
    if (marketPrice == null || !Number.isFinite(marketPrice) || marketPrice <= 0) return;
    if (centeredForPairRef.current === pairKey) return;
    centeredForPairRef.current = pairKey;
    centerPriceScaleOn(marketPrice);
  }, [chartReady, pairKey, marketPrice, centerPriceScaleOn]);
  const {
    drawings,
    add: addDrawing,
    remove: removeDrawing,
    update: updateDrawing,
    clearAll: clearDrawings,
    undo: undoDrawing,
    redo: redoDrawing,
    canUndo,
    canRedo,
  } = useDrawings(pairKey);

  const [tool, setTool] = useState<ToolMode>('none');

  const [menu, setMenu] = useState<{ x: number; y: number; price: number } | null>(null);

  // Cmd/Ctrl-Z and Cmd/Ctrl-Shift-Z for undo/redo, plus Esc to cancel an
  // active drawing tool. Listening on the document so the shortcuts work
  // regardless of which chart sub-element has focus, but we ignore events
  // that bubble out of an editable input/textarea so order-form typing or
  // a pending text-annotation isn't hijacked (the text-annotation input
  // owns its own Esc handler that commits/cancels in place).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        // Esc is a no-op when nothing's active so we don't fight the
        // user's other dialogs/menus that also want Escape.
        if (tool !== 'none' || menu !== null) {
          e.preventDefault();
          setTool('none');
          setMenu(null);
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redoDrawing();
      else undoDrawing();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undoDrawing, redoDrawing, tool, menu]);

  useEffect(() => {
    const initial = readStoredVolumeRatio();
    setVolumeRatioState(initial);
    setVolumeRatio(initial);
  }, [setVolumeRatio]);

  // Tracks whether history has fully painted the chart at least once.
  // Until then, latestCandles does the initial paint (history is heavier
  // and slower). Once history arrives, latestCandles switches to incremental
  // series.update() so each block tick stops wiping pagination.
  const fullySeededRef = useRef(false);

  // Reset on duration change — the chart container unmounts/remounts via the
  // isLoading gate, so the ref must reset alongside that lifecycle.
  useEffect(() => {
    fullySeededRef.current = false;
  }, [duration]);

  useEffect(() => {
    if (!latestCandles?.length) {
      return;
    }
    if (!fullySeededRef.current) {
      // First paint: history hasn't arrived yet, seed with the latest few.
      setCandlesData(latestCandles);
      setVolumeData(latestCandles);
      return;
    }
    // History is already on screen. Push only the rightmost ticks so the
    // 100+ candle series isn't full-replaced on every block.
    updateLatestCandles(latestCandles);
    updateLatestVolumes(latestCandles);
  }, [
    latestCandles,
    setCandlesData,
    setVolumeData,
    updateLatestCandles,
    updateLatestVolumes,
  ]);

  useEffect(() => {
    if (!historyCandles?.pages.length) {
      return;
    }

    // pages need to be reversed, so that data is always in ASC order
    const candles = historyCandles.pages.toReversed().flat();
    setCandlesData(candles);
    setVolumeData(candles);
    fullySeededRef.current = true;
  }, [historyCandles, setCandlesData, setVolumeData]);

  // Stable across renders. Chart re-renders every block-tick via
  // marketPrice; without useCallback the volume divider <div> and the
  // chart container <div> would have their event listeners swapped each
  // tick. setVolumeRatio comes from useChartConfig (already useCallback);
  // priceAtY is also useCallback'd inside the same hook.
  const onDragStart = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      let pendingRatio: number | null = null;
      let rafId = 0;

      // Pointer moves can fire 60-100×/s during a drag — without coalescing
      // we'd hit setState + lightweight-charts applyOptions on every event.
      // Pin the latest ratio in a closure-local cell, flush at most once
      // per animation frame.
      const flush = () => {
        rafId = 0;
        if (pendingRatio === null) return;
        const ratio = pendingRatio;
        pendingRatio = null;
        setVolumeRatioState(ratio);
        setVolumeRatio(ratio);
      };

      const onMove = (ev: PointerEvent) => {
        const offset = ev.clientY - rect.top;
        // ratio = volume's share = portion below cursor
        pendingRatio = Math.min(0.6, Math.max(0.05, 1 - offset / rect.height));
        if (rafId) return;
        rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Drain any pending rAF so the persisted value matches the final
        // pointer position, not a frame behind.
        if (rafId) {
          cancelAnimationFrame(rafId);
          flush();
        }
        // Persist the final value by reading via the state setter (avoids
        // a dual-source-of-truth ref/state pair).
        setVolumeRatioState(current => {
          try {
            window.localStorage.setItem(VOLUME_RATIO_KEY, String(current));
          } catch {
            // ignore storage errors
          }
          return current;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setVolumeRatio],
  );

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const price = priceAtY(y);
      if (price === undefined) return;
      e.preventDefault();
      setMenu({ x: e.clientX - rect.left, y, price });
    },
    [priceAtY],
  );

  // Drawings click handling. lightweight-charts intercepts pointer events on
  // its canvas, so DOM onClick on the container doesn't fire reliably; route
  // through the chart's native subscribeClick. Refs prevent re-subscribing
  // on every tool/state change.
  const toolRef = useRef<ToolMode>(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Pending first anchor for two-click drawing tools (trend-line, rectangle).
  // Lifted to state so the live preview rerenders when the anchor lands —
  // ref alone wouldn't trigger the preview SVG repaint.
  const [pendingAnchor, setPendingAnchor] = useState<{
    x: number;
    y: number;
    time: number;
    price: number;
  } | null>(null);
  // Live cursor position in canvas coords while a tool is active. Used to
  // paint the trend-line / rectangle preview between the anchor and the
  // cursor before the second click lands.
  const [previewCursor, setPreviewCursor] = useState<{ x: number; y: number } | null>(null);
  // Stable callbacks for ClickCaptureOverlay so its memo() isn't busted
  // by a fresh inline-arrow `onCursorLeave` each render.
  const clearPreviewCursor = useCallback(() => setPreviewCursor(null), []);

  // Inline text-input state for the text annotation tool.
  const [pendingText, setPendingText] = useState<{
    x: number;
    y: number;
    time: number;
    price: number;
  } | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');

  // Single click-handling routine used by both the lightweight-charts native
  // subscribeClick (when it fires) and the DOM click-capture overlay above
  // (which is the reliable path while a tool is selected). useCallback'd so
  // the subscribeChartClick effect can list it as a dep without re-firing
  // every render, and so the click-capture overlay's onClick stays stable
  // across the chart's per-block re-renders.
  const handleDrawingClick = useCallback(
    (point: { x: number; y: number }, price: number, time: number | undefined) => {
      const t = toolRef.current;
      if (t === 'text') {
        if (time === undefined) return;
        setPendingText({ x: point.x, y: point.y, time, price });
        setPendingTextValue('');
        return;
      }
      if (t === 'horizontal-line') {
        addDrawing({
          id: `hl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind: 'horizontal-line',
          price,
          color: DRAWING_COLOR,
          createdAt: Date.now(),
        });
        setTool('none');
        return;
      }
      if (t === 'vertical-line') {
        if (time === undefined) return;
        addDrawing({
          id: `vl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind: 'vertical-line',
          time,
          color: DRAWING_COLOR,
          createdAt: Date.now(),
        });
        setTool('none');
        return;
      }
      if (t === 'trend-line' || t === 'rectangle') {
        if (time === undefined) return;
        // First click anchors. Preview line/rect now follows the cursor
        // until the second click commits.
        // (The chart re-render on setPendingAnchor is what makes the
        // preview overlay appear.)
        if (pendingAnchor === null) {
          setPendingAnchor({ x: point.x, y: point.y, time, price });
          return;
        }
        addDrawing({
          id: `${t === 'trend-line' ? 'tl' : 'rc'}-${Date.now()}-${Math.floor(
            Math.random() * 1000,
          )}`,
          kind: t,
          time1: pendingAnchor.time,
          price1: pendingAnchor.price,
          time2: time,
          price2: price,
          color: DRAWING_COLOR,
          createdAt: Date.now(),
        });
        setPendingAnchor(null);
        setPreviewCursor(null);
        setTool('none');
      }
    },
    [addDrawing, pendingAnchor],
  );

  useEffect(() => {
    return subscribeChartClick(handleDrawingClick);
    // chartReady listed so the effect re-runs once createChart has actually
    // mounted — first run at mount sees an empty chart and the inner subscribe
    // would short-circuit otherwise.
  }, [subscribeChartClick, handleDrawingClick, chartReady]);

  // Reset the pending anchor whenever the tool leaves a two-click mode
  // (e.g. user picks cursor mid-placement) so a stale half-shape doesn't
  // hang around.
  useEffect(() => {
    if (tool !== 'trend-line' && tool !== 'rectangle') {
      setPendingAnchor(null);
      setPreviewCursor(null);
    }
    if (tool !== 'text') {
      setPendingText(null);
      setPendingTextValue('');
    }
  }, [tool]);

  const commitPendingText = () => {
    if (!pendingText) return;
    const value = pendingTextValue.trim();
    if (value) {
      addDrawing({
        id: `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        kind: 'text',
        time: pendingText.time,
        price: pendingText.price,
        text: value,
        color: DRAWING_COLOR,
        createdAt: Date.now(),
      });
    }
    setPendingText(null);
    setPendingTextValue('');
    setTool('none');
  };

  const cancelPendingText = () => {
    setPendingText(null);
    setPendingTextValue('');
    setTool('none');
  };

  const buildMenuItems = (price: number): PriceMenuItem[] => {
    const priceStr = formatPrice(price);
    const applyLimit = (direction: 'buy' | 'sell') => () => {
      tradeFormStore.setWhichForm('Limit');
      tradeFormStore.limitForm.setDirection(direction);
      tradeFormStore.limitForm.setPriceInput(priceStr);
    };
    const applyLPBound = (which: 'lower' | 'upper') => () => {
      tradeFormStore.setWhichForm('SimpleLP');
      const setter =
        which === 'lower'
          ? tradeFormStore.simpleLPForm.setLowerPriceInput
          : tradeFormStore.simpleLPForm.setUpperPriceInput;
      setter(price);
    };
    const setAlertHere = () => {
      addAlert({
        pair: pairKey,
        targetPrice: price,
        direction:
          marketPrice == null ? 'above' : price >= marketPrice ? 'above' : 'below',
        browser:
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted',
        ntfyTopic: '',
      });
    };

    // Buy makes sense only below the current mid (you'd be paying above
    // mid to buy, which is a market order — caller should use the chart
    // body for that, not a contextual click). Sell similarly only above.
    // If we don't yet know the mid, show both (legacy behaviour).
    const showBuy = marketPrice == null || price < marketPrice;
    const showSell = marketPrice == null || price > marketPrice;

    const drawHorizontalLine = () => {
      addDrawing({
        id: `hl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        kind: 'horizontal-line',
        price,
        color: DRAWING_COLOR,
        createdAt: Date.now(),
      });
    };
    // Reset goes first — it's the 'I'm lost, take me back' affordance
    // and the trader hits it most often. Other items are price-action
    // (buy/sell), LP bounds, alerts, and chart annotations.
    const items: PriceMenuItem[] = [
      { label: 'Reset chart view', tone: 'neutral', icon: RotateCcw, onSelect: resetView },
    ];
    if (showBuy) {
      items.push({
        label: 'Buy at this price',
        tone: 'buy',
        icon: ShoppingCart,
        onSelect: applyLimit('buy'),
      });
    }
    if (showSell) {
      items.push({
        label: 'Sell at this price',
        tone: 'sell',
        icon: Tag,
        onSelect: applyLimit('sell'),
      });
    }
    items.push(
      {
        label: 'Set as LP lower bound',
        tone: 'neutral',
        icon: ArrowDownToLine,
        onSelect: applyLPBound('lower'),
      },
      {
        label: 'Set as LP upper bound',
        tone: 'neutral',
        icon: ArrowUpToLine,
        onSelect: applyLPBound('upper'),
      },
      {
        label:
          marketPrice != null && price >= marketPrice
            ? 'Alert when price goes above'
            : 'Alert when price drops below',
        tone: 'neutral',
        icon: Bell,
        onSelect: setAlertHere,
      },
      // Drop a horizontal line on the chart at this price level — same
      // result as switching to the line-drawing tool and clicking, just
      // one click instead of two. Useful for marking S/R levels off a
      // glance at the candle.
      {
        label: 'Mark this price (horizontal line)',
        tone: 'neutral',
        icon: MinusIcon,
        onSelect: drawHorizontalLine,
      },
    );
    return items;
  };

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center justify-between border-b border-b-other-solid-stroke px-3'>
        <div className='flex'>
          {durationWindows.map(w => (
            <DurationButton
              key={w}
              value={w}
              active={w === duration}
              onSelect={setDuration}
            />
          ))}
        </div>
        <div className='flex items-center gap-1'>
          <AlertsMenu
            pair={pairKey}
            marketPrice={marketPrice}
            alerts={pairAlerts}
            onAdd={addAlert}
            onRemove={removeAlert}
          />
          <ChartSettingsMenu
            prefs={prefs}
            onToggle={toggle}
            walletConnected={connectionStore.connected}
          />
        </div>
      </div>

      <div className='flex min-h-0 min-w-0 grow'>
        {/* Drawing toolbar in its own narrow column to the left of the
            chart canvas. Always mounted (regardless of loading state)
            so the column is reserved upfront and the chart canvas
            never starts at the panel's left edge — keeps hover-
            tooltip + drawing-toolbar in clearly separate lanes. */}
        <DrawingToolbar
          tool={tool}
          onToolChange={setTool}
          onClearAll={clearDrawings}
          hasDrawings={drawings.length > 0}
          onUndo={undoDrawing}
          onRedo={redoDrawing}
          canUndo={canUndo}
          canRedo={canRedo}
        />
        <div
          className='relative flex min-h-0 min-w-0 grow items-center justify-center overflow-hidden'
          ref={containerRef}
          onContextMenu={onContextMenu}
          style={tool !== 'none' ? CROSSHAIR_STYLE : undefined}
        >
          {/* Click-capture overlay shown only while a drawing tool is
              active. lightweight-charts' own subscribeClick has been
              unreliable here (chart eats some clicks for pan/zoom), so
              we route the drawing placement through a real DOM event
              instead. */}
          {tool !== 'none' && historyCandles && (
            <ClickCaptureOverlay
              priceAtY={priceAtY}
              timeAtX={timeAtX}
              containerRef={containerRef}
              onResolve={handleDrawingClick}
              onCursorMove={
                pendingAnchor && (tool === 'trend-line' || tool === 'rectangle')
                  ? setPreviewCursor
                  : undefined
              }
              onCursorLeave={clearPreviewCursor}
            />
          )}
          {error && <BlockchainError direction='column' />}
          {!error && isLoading && <ChartLoadingState />}
          {!error && !isLoading && historyCandles && (
            <>
              <div className='h-full w-full' ref={chartRef} />
              {prefs.depth && (
                <DepthOverlay yAtPrice={yAtPrice} subscribeRedraw={subscribeRedraw} />
              )}
              {/* Live preview of the LP position the trader is constructing —
                  only paints when whichForm is SimpleLP / RangeLP and bounds
                  are set, so it's a no-op for traders not in LP mode. */}
              <LpPreviewOverlay
                yAtPrice={yAtPrice}
                priceAtY={priceAtY}
                subscribeRedraw={subscribeRedraw}
              />
              {/* Drag-to-reprice handles on the user's own resting LP
                  orders. Gated on prefs.ownPositions so it matches the
                  visibility of the underlying price lines. */}
              <OwnPositionsDragOverlay
                yAtPrice={yAtPrice}
                priceAtY={priceAtY}
                subscribeRedraw={subscribeRedraw}
                enabled={prefs.ownPositions && connectionStore.connected}
              />
              {/* Live preview line for the limit order being composed —
                  paints only while the Limit form is active and the
                  price input has a value, so the trader sees exactly
                  where the resting order will sit (and whether it would
                  cross the spread) before pressing Submit. */}
              <LimitPreviewOverlay yAtPrice={yAtPrice} subscribeRedraw={subscribeRedraw} />
              {prefs.midPrice && (
                <MidPriceOverlay
                  marketPrice={marketPrice}
                  spreadPercentage={spreadPercentage}
                  yAtPrice={yAtPrice}
                  subscribeRedraw={subscribeRedraw}
                  quoteSymbol={quoteSymbol}
                />
              )}
              <DrawingsOverlay
                drawings={drawings}
                yAtPrice={yAtPrice}
                xAtTime={xAtTime}
                priceAtY={priceAtY}
                timeAtX={timeAtX}
                subscribeRedraw={subscribeRedraw}
                onDelete={removeDrawing}
                onUpdate={updateDrawing}
              />
              {/* Each active price alert paints as a dotted horizontal
                  line on the chart with a left-edge 🔔 label and a
                  right-edge × button to remove it inline — saves the
                  trader a trip back to the bell-icon menu just to
                  cancel a stale alert. */}
              <AlertsOverlay
                alerts={pairAlerts}
                yAtPrice={yAtPrice}
                subscribeRedraw={subscribeRedraw}
                onRemove={removeAlert}
              />
              {/* Live preview while drawing trend-line / rectangle —
                  first click anchors and the second endpoint follows
                  the cursor until the second click commits, so the
                  trader sees the shape they're about to drop instead
                  of stabbing blind. */}
              {pendingAnchor &&
                previewCursor &&
                (tool === 'trend-line' || tool === 'rectangle') && (
                  <svg
                    aria-label='Drawing preview'
                    className='pointer-events-none absolute inset-0 z-[7] h-full w-full'
                    style={{ overflow: 'visible' }}
                  >
                    {tool === 'trend-line' && (
                      <>
                        <line
                          x1={pendingAnchor.x}
                          y1={pendingAnchor.y}
                          x2={previewCursor.x}
                          y2={previewCursor.y}
                          stroke={DRAWING_COLOR}
                          strokeWidth='1.5'
                          strokeDasharray='4 3'
                          opacity='0.85'
                        />
                        <circle
                          cx={pendingAnchor.x}
                          cy={pendingAnchor.y}
                          r={3}
                          fill={DRAWING_COLOR}
                        />
                        <circle
                          cx={previewCursor.x}
                          cy={previewCursor.y}
                          r={3}
                          fill={DRAWING_COLOR}
                          opacity='0.6'
                        />
                      </>
                    )}
                    {tool === 'rectangle' && (
                      <rect
                        x={Math.min(pendingAnchor.x, previewCursor.x)}
                        y={Math.min(pendingAnchor.y, previewCursor.y)}
                        width={Math.abs(previewCursor.x - pendingAnchor.x)}
                        height={Math.abs(previewCursor.y - pendingAnchor.y)}
                        fill={DRAWING_COLOR}
                        fillOpacity={0.1}
                        stroke={DRAWING_COLOR}
                        strokeWidth='1'
                        strokeDasharray='4 3'
                        opacity='0.85'
                      />
                    )}
                  </svg>
                )}
              <HoverTooltip subscribeHover={subscribeHover} quoteSymbol={quoteSymbol} />
            {pendingText && (
              <input
                autoFocus
                value={pendingTextValue}
                onChange={e => setPendingTextValue(e.target.value)}
                onBlur={commitPendingText}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPendingText();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelPendingText();
                  }
                }}
                placeholder='Type and press Enter…'
                className='absolute z-30 rounded-sm border border-other-tonal-stroke bg-base-black px-2 py-1 text-xs text-text-primary shadow-md outline-none focus:border-text-primary'
                style={{
                  left: pendingText.x,
                  top: Math.max(0, pendingText.y - 12),
                  minWidth: 160,
                }}
              />
            )}
            <div
              role='separator'
              aria-orientation='horizontal'
              onPointerDown={onDragStart}
              className='absolute left-0 right-0 z-10 h-2 -translate-y-1/2 cursor-row-resize bg-transparent hover:bg-other-solid-stroke/40'
              style={{ top: `${(1 - volumeRatio) * 100}%` }}
            />
            {menu && (() => {
              // Live % gap from chain mid for the right-clicked level.
              // Suppress sub-bp moves so the header doesn't flicker
              // '0.00% from mid' on a level the trader picked at-the-mid.
              const deltaPct =
                marketPrice && marketPrice > 0
                  ? ((menu.price - marketPrice) / marketPrice) * 100
                  : null;
              const priceFromMid =
                deltaPct !== null && Math.abs(deltaPct) >= 0.05
                  ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%`
                  : null;
              return (
                <PriceContextMenu
                  x={menu.x}
                  y={menu.y}
                  price={formatPrice(menu.price)}
                  priceFromMid={priceFromMid}
                  items={buildMenuItems(menu.price)}
                  onClose={() => setMenu(null)}
                />
              );
            })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

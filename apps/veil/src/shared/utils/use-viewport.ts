import { useEffect, useMemo, useState } from 'react';
import { theme } from '@penumbra-zone/ui/theme';
import { useDebounce } from '@/shared/utils/use-debounce';

const breakpoints = theme.breakpoint;
export type Viewport = keyof typeof breakpoints;

/**
 * A client-only component that returns the viewport type
 */
export const useViewport = (): Viewport => {
  const [width, setWidth] = useState<number>(breakpoints.lg);
  const debouncedWidth = useDebounce(width, 250);

  useEffect(() => {
    // Window 'resize' fires 60+ times per second while the user is dragging
    // the window edge. Each one was hitting setWidth → re-render of every
    // useViewport caller (and re-firing the useDebounce timeout below).
    // Coalesce to one setState per animation frame so we read clientWidth
    // at most once per paint; useDebounce still smooths the final break
    // across the 250ms threshold as before.
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      setWidth(document.body.clientWidth);
    };
    const onResize = () => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(flush);
    };
    flush();

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return useMemo(() => {
    if (debouncedWidth < breakpoints.tablet) {
      return 'mobile';
    }
    if (debouncedWidth < breakpoints.desktop) {
      return 'tablet';
    }
    if (debouncedWidth < breakpoints.lg) {
      return 'desktop';
    }
    if (debouncedWidth < breakpoints.xl) {
      return 'lg';
    }
    return 'xl';
  }, [debouncedWidth]);
};

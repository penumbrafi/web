import { useEffect } from 'react';
import { LAST_PAIR_COOKIE, LAST_PAIR_COOKIE_MAX_AGE } from '@/shared/config/featured-pairs';
import { usePathSymbols } from './use-path';

/**
 * Remember the pair the trade page is showing, so /trade returns to it.
 * Runs only when the page actually renders in the browser; a prefetch never
 * mounts it, so pairs you only scrolled past can't become "last viewed".
 */
export const useRememberPair = () => {
  const { baseSymbol, quoteSymbol } = usePathSymbols();
  useEffect(() => {
    if (!baseSymbol || !quoteSymbol) {
      return;
    }
    const value = `${encodeURIComponent(baseSymbol)}/${encodeURIComponent(quoteSymbol)}`;
    document.cookie = `${LAST_PAIR_COOKIE}=${value}; path=/; max-age=${LAST_PAIR_COOKIE_MAX_AGE}; samesite=lax`;
  }, [baseSymbol, quoteSymbol]);
};

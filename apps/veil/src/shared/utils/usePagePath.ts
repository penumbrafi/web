'use client';

import { usePathname } from 'next/navigation';
import { PagePath } from '../const/pages';

const removeTrailingSlash = (url: string): string => {
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

// Lazy-cached at first call instead of module load — usePagePath.ts
// participates in a circular import with pages.ts (which itself
// imports usePagePath), so reading PagePath at module top-level
// evaluates to undefined under SSR.
interface PathCache {
  values: string[];
  valueSet: Set<string>;
  parametric: { value: PagePath; regex: RegExp }[];
}
let cache: PathCache | null = null;
const ensureCache = (): PathCache => {
  if (cache) {
    return cache;
  }
  const values: string[] = Object.values(PagePath);
  cache = {
    values,
    valueSet: new Set(values),
    parametric: values
      .filter(p => p.includes(':'))
      .map(p => ({
        value: p as PagePath,
        regex: new RegExp('^' + p.replace(/:(\w+)/g, '([^/]+)') + '$'),
      })),
  };
  return cache;
};

const matchPagePath = (str: string): PagePath => {
  const { values, valueSet, parametric } = ensureCache();
  if (valueSet.has(str)) {
    return str as PagePath;
  }
  for (const { value, regex } of parametric) {
    if (regex.test(str)) {
      return value;
    }
  }
  // Fall back to the longest PagePath prefix so sub-pages outside the
  // explicit enum (e.g. /explore/validators, /explore/blocks) light up
  // their parent tab instead of defaulting to Home. Skip parametric
  // entries (handled above) and the bare '/' (it'd match everything).
  let bestMatch: PagePath = PagePath.Home;
  let bestLen = 0;
  for (const candidate of values) {
    if (candidate.includes(':') || candidate === '/') {
      continue;
    }
    if (str === candidate || str.startsWith(candidate + '/')) {
      if (candidate.length > bestLen) {
        bestLen = candidate.length;
        bestMatch = candidate as PagePath;
      }
    }
  }
  return bestMatch;
};

export const usePagePath = () => {
  const pathname = usePathname();
  return matchPagePath(removeTrailingSlash(pathname ?? ''));
};

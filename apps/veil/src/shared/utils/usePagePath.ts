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
let _pathValues: string[] | null = null;
let _pathValuesSet: Set<string> | null = null;
let _parametricPaths: { value: PagePath; regex: RegExp }[] | null = null;
const ensureCache = () => {
  if (_pathValues) {
    return;
  }
  _pathValues = Object.values(PagePath);
  _pathValuesSet = new Set<string>(_pathValues);
  _parametricPaths = _pathValues
    .filter(p => p.includes(':'))
    .map(p => ({
      value: p as PagePath,
      regex: new RegExp('^' + p.replace(/:(\w+)/g, '([^/]+)') + '$'),
    }));
};

const matchPagePath = (str: string): PagePath => {
  ensureCache();
  if (_pathValuesSet!.has(str)) {
    return str as PagePath;
  }
  for (const { value, regex } of _parametricPaths!) {
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
  for (const candidate of _pathValues!) {
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

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';
import Density from '../density';
import SegmentedControl from '../segmentedControl';

type Option = 'apy' | 'topStake' | 'growth7d' | 'growth30d' | 'realized30d';

const STORAGE_KEY = 'veil:validators:sort';

const URL_FOR: Record<Option, { sort?: string; dir?: string }> = {
  topStake: {},
  apy: { sort: 'apy', dir: 'desc' },
  growth7d: { sort: 'growth7d', dir: 'desc' },
  growth30d: { sort: 'growth30d', dir: 'desc' },
  realized30d: { sort: 'realized30d', dir: 'desc' },
};

const isOption = (v: string | null): v is Option =>
  v === 'topStake' || v === 'apy' || v === 'growth7d' || v === 'growth30d' || v === 'realized30d';

interface Props {
  className?: string;
}

const ValidatorSortToggle: FC<Props> = ({ className }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const sortParam = searchParams?.get('sort') ?? null;
  const current: Option = isOption(sortParam) ? sortParam : 'topStake';

  // On mount with no explicit sort param, hydrate the user's last
  // choice from localStorage so the preference survives across
  // sessions without baking it into the SSR URL.
  useEffect(() => {
    if (sortParam) {
      return;
    }
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    if (!isOption(stored) || stored === 'topStake') {
      return;
    }
    const target = URL_FOR[stored];
    const params = new URLSearchParams(searchParams ?? undefined);
    if (target.sort) {
      params.set('sort', target.sort);
    }
    if (target.dir) {
      params.set('dir', target.dir);
    }
    params.delete('page');
    router.replace(`${pathname}?${params}`);
  }, [pathname, router, searchParams, sortParam]);

  const onChange = useCallback(
    (value: string) => {
      if (!isOption(value) || value === current) {
        return;
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, value);
      }
      const params = new URLSearchParams(searchParams ?? undefined);
      const target = URL_FOR[value];
      if (target.sort) {
        params.set('sort', target.sort);
      } else {
        params.delete('sort');
      }
      if (target.dir) {
        params.set('dir', target.dir);
      } else {
        params.delete('dir');
      }
      params.delete('page');
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ''}`);
    },
    [current, pathname, router, searchParams],
  );

  return (
    <Density compact>
      <SegmentedControl className={className} onChange={onChange} value={current}>
        <SegmentedControl.Item style='filled' value='topStake'>
          Top stake
        </SegmentedControl.Item>
        <SegmentedControl.Item style='filled' value='apy'>
          Est. APY
        </SegmentedControl.Item>
        <SegmentedControl.Item style='filled' value='growth7d'>
          Δ stake 7d
        </SegmentedControl.Item>
        <SegmentedControl.Item style='filled' value='growth30d'>
          Δ stake 30d
        </SegmentedControl.Item>
        <SegmentedControl.Item style='filled' value='realized30d'>
          Realized APY
        </SegmentedControl.Item>
      </SegmentedControl>
    </Density>
  );
};

export default ValidatorSortToggle;

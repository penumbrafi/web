'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FC } from 'react';

interface NavItem {
  label: string;
  href: string;
  matchPrefixes?: string[];
}

const ITEMS: NavItem[] = [
  { label: 'Overview', href: '/explore' },
  { label: 'Blocks', href: '/explore/blocks', matchPrefixes: ['/explore/block'] },
  { label: 'Transactions', href: '/explore/txs', matchPrefixes: ['/explore/tx'] },
  { label: 'Validators', href: '/explore/validators', matchPrefixes: ['/explore/validator'] },
  { label: 'Governance', href: '/explore/governance', matchPrefixes: ['/explore/proposal'] },
  { label: 'IBC', href: '/explore/ibc' },
  { label: 'DEX', href: '/explore/dex' },
  { label: 'LPs', href: '/explore/lp-leaderboard', matchPrefixes: ['/explore/lp/'] },
];

const isActive = (item: NavItem, pathname: string): boolean => {
  if (item.href === '/explore') {
    return pathname === '/explore';
  }
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.matchPrefixes ?? []).some(prefix => pathname.startsWith(prefix));
};

export const InspectNav: FC = () => {
  const pathname = usePathname() ?? '';

  return (
    <nav className='flex justify-center border-b border-other-tonal-fill5'>
      <ul className='flex flex-wrap gap-1 px-4 py-2'>
        {ITEMS.map(item => {
          const active = isActive(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={[
                  'inline-block rounded-full px-3 py-1 text-sm transition-colors',
                  active
                    ? 'bg-other-tonal-fill5 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                ].join(' ')}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default InspectNav;

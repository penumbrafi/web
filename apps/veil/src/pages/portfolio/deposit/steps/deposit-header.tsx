'use client';

import { ChevronRight } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';

interface Crumb {
  label: string;
  onClick?: () => void;
}

interface DepositHeaderProps {
  crumbs: Crumb[];
}

/**
 * Breadcrumb / step trail rendered above every step of the deposit flow.
 * Each crumb with `onClick` is clickable and jumps back to that step;
 * the last crumb is styled as the current position.
 */
export const DepositHeader = ({ crumbs }: DepositHeaderProps) => (
  <div className='flex flex-wrap items-center gap-1 text-text-secondary'>
    {crumbs.map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      const clickable = crumb.onClick && !isLast;
      return (
        <span key={`${i}-${crumb.label}`} className='flex items-center gap-1'>
          {i > 0 && <ChevronRight className='h-3.5 w-3.5 shrink-0' aria-hidden />}
          {clickable ? (
            <button
              type='button'
              onClick={crumb.onClick}
              className='rounded-md px-1 py-0.5 hover:bg-other-tonal-fill5 hover:text-text-primary'
            >
              <Text small color='text.secondary'>
                {crumb.label}
              </Text>
            </button>
          ) : (
            <span className='px-1'>
              <Text small color={isLast ? 'text.primary' : 'text.secondary'}>
                {crumb.label}
              </Text>
            </span>
          )}
        </span>
      );
    })}
  </div>
);

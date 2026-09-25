'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { ErrorResponse } from '@/lib/api';

interface Props {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  /** True while a refetch is in flight; the chart body dims but stays put. */
  loading?: boolean;
  error?: ErrorResponse | undefined;
  empty?: boolean;
  children: ReactNode;
}

/**
 * Card around a chart: title row with the chart's own controls on the
 * right, then the plot. Loading keeps the previous render at reduced
 * opacity (no skeleton, no layout jump); an indexer error replaces the plot
 * with an explicit message rather than an empty axis.
 */
export const ChartFrame = ({
  title,
  subtitle,
  controls,
  loading,
  error,
  empty,
  children,
}: Props) => (
  <section className='rounded-md border border-other-tonal-stroke bg-neutral-dark'>
    <div className='flex flex-wrap items-center justify-between gap-2 border-b border-other-tonal-stroke px-4 py-3'>
      <div>
        <h2 className='text-sm font-medium text-text-primary'>{title}</h2>
        {subtitle && <p className='text-xs text-text-secondary'>{subtitle}</p>}
      </div>
      {controls && <div className='flex flex-wrap items-center gap-2'>{controls}</div>}
    </div>
    <div className={clsx('relative px-2 py-3 transition-opacity', loading && 'opacity-50')}>
      <Body error={error} empty={empty} loading={loading}>
        {children}
      </Body>
    </div>
  </section>
);

const Body = ({
  error,
  empty,
  loading,
  children,
}: Pick<Props, 'error' | 'empty' | 'loading' | 'children'>) => {
  if (error) {
    return <ErrorState error={error} />;
  }
  if (empty) {
    return (
      <div className='flex h-64 items-center justify-center text-sm text-text-secondary'>
        {loading ? 'Loading…' : 'No data.'}
      </div>
    );
  }
  return children;
};

export const ErrorState = ({ error }: { error: ErrorResponse }) => (
  <div
    role='alert'
    className='flex h-64 flex-col items-center justify-center gap-1 text-center text-sm'
  >
    <span className='font-medium text-caution-light'>
      {error.error === 'indexer_unreachable' ? 'Indexer unreachable' : 'Request failed'}
    </span>
    <span className='text-text-secondary'>{error.message}</span>
  </div>
);

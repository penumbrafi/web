'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/shared/ui/skeleton';

// Defer the deposit flow so cosmos-kit + chain-registry only load once the
// user actually navigates in. Must be a client boundary (`'use client'` +
// dynamic without ssr) — cosmos-kit's `useChain` cannot SSR.
const DepositPage = dynamic(
  () => import('@/pages/portfolio/deposit/deposit-page').then(m => ({ default: m.DepositPage })),
  {
    ssr: false,
    loading: () => (
      <div className='container mx-auto flex max-w-[720px] flex-col gap-4 py-8'>
        <div className='h-16'>
          <Skeleton />
        </div>
        <div className='h-96'>
          <Skeleton />
        </div>
      </div>
    ),
  },
);

export default function Page() {
  return <DepositPage />;
}

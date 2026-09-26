'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/shared/ui/skeleton';

// Client-only like /portfolio/deposit: cosmos-kit's useChain cannot SSR, and
// the recipient address lives in the URL fragment, which only the browser sees.
const PayPage = dynamic(() => import('@/pages/pay/pay-page').then(m => ({ default: m.PayPage })), {
  ssr: false,
  loading: () => (
    <div className='container mx-auto flex max-w-[720px] flex-col gap-4 py-8'>
      <div className='h-96'>
        <Skeleton />
      </div>
    </div>
  ),
});

export default function Page() {
  return <PayPage />;
}

'use client';

import dynamic from 'next/dynamic';

// Defer the deposit flow so cosmos-kit + chain-registry only load once the
// user actually opens it. Must be a client boundary (`'use client'` +
// dynamic without ssr) - cosmos-kit's `useChain` cannot SSR.
const DepositModal = dynamic(
  () => import('@/pages/portfolio/deposit/deposit-page').then(m => ({ default: m.DepositModal })),
  { ssr: false },
);

export default function Page() {
  return <DepositModal />;
}

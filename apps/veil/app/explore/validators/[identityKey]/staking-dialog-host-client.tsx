'use client';

import dynamic from 'next/dynamic';

// Next 15 forbids `ssr: false` on `next/dynamic` inside a Server Component,
// so this thin client wrapper owns the dynamic import. Skipping SSR is
// required — `StakingDialogHost` pulls in the `penumbra` wallet client
// (a window-only object) via its data hooks.
export const StakingDialogHostClient = dynamic(
  () =>
    import('@/pages/portfolio/staking/ui/staking-dialog-host').then(m => ({
      default: m.StakingDialogHost,
    })),
  { ssr: false },
);

'use client';

import dynamic from 'next/dynamic';

// SSR the buttons empty. The component observes `stakingStore` (mobx) and
// reads `connectionStore`, which are wallet-adjacent client-only stores;
// letting Next SSR real markup for these makes hydration inconsistent
// under React 19.2 and trips a #441 hydration mismatch on the validator
// detail page. `ssr: false` renders `null` on the server and mounts the
// real component after hydration, so there's nothing to reconcile.
export const ValidatorStakeActionsClient = dynamic(
  () =>
    import('@/pages/inspect/explorer/ui/validator-stake-actions').then(m => ({
      default: m.ValidatorStakeActions,
    })),
  { ssr: false },
);

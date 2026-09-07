'use client';

import { lazy, Suspense, useMemo, useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { theme as penumbraTheme } from '@penumbra-zone/ui/theme';
import { ShieldDialog } from '@/pages/portfolio/ui/shield-dialog';
import { Skeleton } from '@/shared/ui/skeleton';
import { useDepositAddress } from './use-deposit-address';
import {
  DepositMethodPicker,
  DepositBackToPicker,
  type DepositRoute,
} from './deposit-method-picker';

const LazySkipWidget = lazy(() => import('@skip-go/widget').then(mod => ({ default: mod.Widget })));

interface DepositDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Skip's theme prop is `"dark" | "light" | PartialTheme`. Passing just
// `{ brandColor }` makes Skip fall back to its light defaults, so the
// 'Connect Wallet' button rendered white-on-white over our dark dialog.
// Use the dark preset and pass brandColor through the dedicated prop.
const SKIP_THEME = 'dark' as const;
const SKIP_BRAND_COLOR = penumbraTheme.color.primary.main;

const SkeletonFallback = () => (
  <div className='flex h-[420px] w-full items-center justify-center p-4'>
    <Skeleton />
  </div>
);

/**
 * Two-step deposit modal:
 *
 *  1. DepositMethodPicker — quick chips for the user's likely source
 *     chain (Cosmos Hub, Osmosis, Noble, Ethereum, …). Picking a
 *     chip pre-fills Skip's defaultRoute so the user lands on the right
 *     source chain + asset without scrolling Skip's chain list.
 *  2. Skip widget — embedded, with `connectedAddresses['penumbra-1']`
 *     set to a freshly-rotated ephemeral address so the user never has
 *     to copy or paste a Penumbra address.
 *
 * The user can always go back from the Skip view to re-pick. The
 * ephemeral address is regenerated each time the dialog reopens (60s
 * staleTime in useDepositAddress).
 */
export const DepositDialog = observer(({ isOpen, onClose }: DepositDialogProps) => {
  const { data: penumbraAddress } = useDepositAddress();
  const [route, setRoute] = useState<DepositRoute | null>(null);

  // Reset back to the picker every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) {
      setRoute(null);
    }
  }, [isOpen]);

  const connectedAddresses = useMemo(
    () => (penumbraAddress ? { 'penumbra-1': penumbraAddress } : undefined),
    [penumbraAddress],
  );

  const skipDefaultRoute = useMemo(
    () =>
      route
        ? {
            srcChainId: route.srcChainId,
            srcAssetDenom: route.srcAssetDenom,
            destChainId: 'penumbra-1',
          }
        : undefined,
    [route],
  );

  return (
    <ShieldDialog isOpen={isOpen} onClose={onClose}>
      {!route ? (
        <DepositMethodPicker onPick={setRoute} />
      ) : (
        <div className='flex flex-col gap-3'>
          <DepositBackToPicker onBack={() => setRoute(null)} />
          <Suspense fallback={<SkeletonFallback />}>
            <LazySkipWidget
              key={`${route.srcChainId}-${route.srcAssetDenom}`}
              defaultRoute={skipDefaultRoute}
              filter={{
                destination: {
                  'penumbra-1': undefined,
                },
              }}
              connectedAddresses={connectedAddresses}
              theme={SKIP_THEME}
              brandColor={SKIP_BRAND_COLOR}
              enableAmplitudeAnalytics={false}
            />
          </Suspense>
        </div>
      )}
    </ShieldDialog>
  );
});

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import { ShieldedAssetsPage } from '@/pages/shielded-assets';

export const metadata: Metadata = {
  title: 'Shielded pool',
  description:
    'Value of the Penumbra shielded pool over time, and every asset’s shielded balance, inflow and depositors.',
};

export default function AssetsPage() {
  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>Shielded pool</Breadcrumb>
      </Breadcrumbs>
      {/* useSearchParams needs a boundary to prerender the shell. */}
      <Suspense>
        <ShieldedAssetsPage />
      </Suspense>
    </Container>
  );
}

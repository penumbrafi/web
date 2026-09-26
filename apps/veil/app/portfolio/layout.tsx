import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { userAgent } from 'next/server';
import { PortfolioPage } from '@/pages/portfolio';

export const dynamic = 'force-dynamic';

// The portfolio renders here, once, for every /portfolio/* route. Child routes
// (deposit, withdraw) are dialogs on top of it, so opening or closing one
// doesn't reload the balances underneath.
export default async function PortfolioLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const { device } = userAgent({ headers: headersList });
  return (
    <>
      <PortfolioPage isMobile={device.type === 'mobile'} />
      {children}
    </>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Penumbra Assets',
  description: 'Historical shielded balances of every asset on penumbra-1, and UM supply.',
  robots: { index: false, follow: false },
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang='en'>
    <body>{children}</body>
  </html>
);

export default RootLayout;

'use client';

import { VeilVersion } from './veil-version';

/**
 * Sitewide footer. Rendered on every page (was previously gated to
 * /explore only) — this is a wallet-connected app, and the source
 * affordance is a trust signal that belongs where people can always
 * see it, not just on one page. The commit link inside `VeilVersion`
 * lands on the exact commit hash the build was made from, so users
 * can verify what they're running against the public repo.
 */
export const Footer = () => {
  return (
    <footer className='mt-auto border-t border-t-other-solid-stroke px-6 py-4'>
      <div className='flex justify-center'>
        <VeilVersion />
      </div>
    </footer>
  );
};

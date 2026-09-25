'use client';

import { observer } from 'mobx-react-lite';
import { connectionStore } from '@/shared/model/connection';

/**
 * Persistent banner shown when the wallet extension is present and connected
 * to this origin but LOCKED (no password entered since it started). Without
 * this, `statusStore.setup` retries its status call every second and the
 * sync-bar sits at "loading" indefinitely — the user has no way to know
 * that the fix is "click your extension icon and enter your password."
 *
 * Web pages cannot programmatically open a browser extension's side panel
 * (that requires a user gesture on the extension's own icon, per Chrome's
 * security model), so this banner tells the user exactly what to click.
 * `connectionStore.markWalletUnlocked()` clears the banner automatically
 * as soon as any ViewService call succeeds again.
 */
export const WalletLockedBanner = observer(() => {
  if (!connectionStore.walletLocked) {return null;}
  return (
    <div className='w-full border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-100'>
      <div className='mx-auto flex max-w-6xl items-center gap-3'>
        <span aria-hidden className='text-lg'>🔒</span>
        <div className='flex-1'>
          <div className='font-medium'>Your Penumbra wallet is locked.</div>
          <div className='text-xs opacity-90'>
            Click the wallet extension icon in your browser toolbar and enter your
            password. This page will resume automatically once it detects the
            unlock — no reload needed.
          </div>
        </div>
      </div>
    </div>
  );
});

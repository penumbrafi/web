import { ReactNode } from 'react';
import { App } from './app';
import { getClientSideEnv } from '@/shared/api/env/getClientSideEnv';
import { ChunkReloadGuard } from '@/shared/ui/chunk-reload-guard';

import '@penumbra-zone/ui/style.css';
import '@penumbra-zone/ui/theme.css';
import './v2.css';

// Inline-script chunk guard: runs at HTML parse time so it's in place
// before webpack ever starts fetching chunks. The React-mounted
// <ChunkReloadGuard /> handles errors that fire after hydration; this
// catches the harder case — a ChunkLoadError thrown during initial
// hydration itself, which would otherwise stay 'Uncaught' because the
// useEffect-mounted listener doesn't exist yet.
const INLINE_CHUNK_GUARD = `
(function () {
  if (typeof window === 'undefined') return;
  var KEY = '__veil_chunk_reload_at';
  var match = function (msg) {
    return /Loading chunk \\d+ failed|Loading CSS chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg || '');
  };
  var reloadOnce = function () {
    try {
      var last = Number(window.sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 60000) return;
      window.sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) {}
    window.location.reload();
  };
  window.addEventListener('error', function (e) {
    var err = e.error || {};
    if (err.name === 'ChunkLoadError' || match(err.message || e.message)) {
      e.preventDefault && e.preventDefault();
      reloadOnce();
    }
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    var msg = typeof r === 'string' ? r : (r.message || '');
    if (r.name === 'ChunkLoadError' || match(msg)) {
      e.preventDefault && e.preventDefault();
      reloadOnce();
    }
  });
})();
`;

// Layout used to fetch the chain registry server-side and pass it down
// as a prop into <App>. That embedded ~250KB of JSON into the RSC
// payload of every page response. The registry is now fetched
// client-side in <RegistryProvider> via /api/registry, with
// localStorage caching, so the layout has no per-request data deps.

const RootLayout = ({ children }: { children: ReactNode }) => {
  const clientEnv = getClientSideEnv();
  return (
    <html lang='en'>
      <head>
        { }
        <script dangerouslySetInnerHTML={{ __html: INLINE_CHUNK_GUARD }} />
      </head>
      <body className='scroll-area-page'>
        <ChunkReloadGuard />
        <App clientEnv={clientEnv}>{children}</App>
      </body>
    </html>
  );
};

export default RootLayout;

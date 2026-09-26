import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE } from '@/shared/config/site';

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card shown when a penumbra.fi link is shared. */
export default async function OpengraphImage() {
  const symbol = await readFile(join(process.cwd(), 'app/icon.svg'));
  const symbolSrc = `data:image/svg+xml;base64,${symbol.toString('base64')}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'radial-gradient(circle at 20% 20%, #3a2a18 0%, #0d0d0d 60%)',
          color: '#fafafa',
          fontFamily: 'sans-serif',
        }}
      >
        <img src={symbolSrc} width={238} height={141} alt='' />
        <div style={{ marginTop: 48, fontSize: 72, fontWeight: 700, letterSpacing: -1 }}>
          Private trading on Penumbra
        </div>
        <div style={{ marginTop: 24, fontSize: 34, color: '#a0a0a0', maxWidth: 980 }}>
          Trade, provide liquidity and stake with balances and strategies that stay shielded.
        </div>
      </div>
    ),
    size,
  );
}

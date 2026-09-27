import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// The app sources compile with the automatic JSX runtime under Next, but
// vitest's esbuild uses the classic transform, so expose `React` globally.
(globalThis as unknown as { React: typeof React }).React = React;
import { expect, test } from 'vitest';
import { HeadlineStats } from './headline-stats';
import { IssuancePanel } from './issuance-panel';
import type { InflationPoint } from '../server/timeseries';

test('tokenomics panels render against the smoke DB', async () => {
  const metrics = await import('../server/metrics').then(m => m.fetchTokenomicsMetrics());
  const inflation: InflationPoint[] = [
    { date: '2026-08-28', annualizedPct: 2.6 },
    { date: '2026-09-27', annualizedPct: 2.3 },
  ];
  const html = renderToStaticMarkup(
    <>
      <HeadlineStats metrics={metrics} />
      <IssuancePanel metrics={metrics} inflation={inflation} />
    </>,
  );
  const text = html
    .replace(/<[^>]+>/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('RENDERED-TEXT>>>', text);

  // Labels the user flagged as wrong on the live page.
  expect(text).toContain('Staking APY');
  expect(text).toContain('net of commission');
  expect(text).not.toContain('Annual issuance');
  expect(text).toContain('Realized inflation');
  expect(text).toContain('Pre-commission');
});

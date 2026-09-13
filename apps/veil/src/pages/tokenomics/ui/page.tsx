import { PenumbraWaves } from '@/pages/explore/ui/waves';
import { LearnNav } from '@/pages/learn/ui/learn-nav';
import { fetchTokenomicsMetrics } from '../server/metrics';
import { fetchTokenomicsTimeseries } from '../server/timeseries';
import { TokenomicsHero } from './hero';
import { HeadlineStats } from './headline-stats';
import { WhatUmIs } from './what-um-is';
import { Information } from './information';
import { NoMev } from './no-mev';
import { IssuancePanel } from './issuance-panel';
import { Arbitrage } from './arbitrage';
import { BurnPanel } from './burn-panel';
import { SupplyComposition } from './supply-composition';
import { WhatsBurned } from './whats-burned';
import { Earn } from './earn';

const fmtUMShort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M UM`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K UM`;
  return `${n.toFixed(0)} UM`;
};
const fmtCount = (n: number) => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

/**
 * UM tokenomics page. Mixes educational copy with live pindexer data:
 *
 *   Hero          → 24h DEX volume, trades, total burned
 *   HeadlineStats → supply, %staked, annualized issuance, total burned
 *   IssuancePanel → 90d annualized inflation chart
 *   BurnPanel     → daily arb vs fee burns chart
 *   SupplyComposition → staked vs unstaked stacked-area over 90d
 *
 * If pindexer is unreachable we render the page anyway with `metrics`/
 * timeseries set to undefined; the pure-educational sections still display.
 */
export const TokenomicsPage = async () => {
  let metrics: Awaited<ReturnType<typeof fetchTokenomicsMetrics>> | null = null;
  let timeseries: Awaited<ReturnType<typeof fetchTokenomicsTimeseries>> | null = null;
  try {
    [metrics, timeseries] = await Promise.all([
      fetchTokenomicsMetrics(),
      fetchTokenomicsTimeseries(90),
    ]);
  } catch (e) {
    // Pindexer unreachable in dev → fall through to no-data rendering.
    console.error('[tokenomics] pindexer fetch failed:', e);
  }

  const heroStats = metrics
    ? {
        dexVolume24h:
          metrics.dexVolume24h !== null ? `${fmtUMShort(metrics.dexVolume24h)}` : '—',
        umBurned24h:
          metrics.burned24h !== null ? `${fmtUMShort(metrics.burned24h)}` : '—',
        trades24h: metrics.trades24h !== null ? fmtCount(metrics.trades24h) : '—',
      }
    : undefined;

  return (
    <>
      <LearnNav />
      <section className='mx-auto flex max-w-[1062px] flex-col gap-10 p-4 desktop:gap-14 desktop:py-10'>
        <PenumbraWaves />
        <TokenomicsHero stats={heroStats} />
      {metrics && <HeadlineStats metrics={metrics} />}
      <WhatUmIs />
      <Information />
      <NoMev />
      {metrics && timeseries && (
        <IssuancePanel metrics={metrics} inflation={timeseries.inflation} />
      )}
      <Arbitrage />
      {metrics && timeseries && (
        <BurnPanel metrics={metrics} burns={timeseries.burns} />
      )}
      {metrics && timeseries && (
        <SupplyComposition metrics={metrics} supply={timeseries.supply} />
      )}
        <WhatsBurned />
        <Earn />
      </section>
    </>
  );
};

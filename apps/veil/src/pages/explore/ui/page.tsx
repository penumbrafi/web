import { ExploreStats } from './stats';
import { ExplorePairs } from './pairs';
import { PenumbraWaves } from './waves';
import { ExploreHero } from './hero';
import { GetStarted } from './get-started';
import { fetchRegistry } from '@/shared/api/fetch-registry';
import { getClientSideEnv } from '@/shared/api/env/getClientSideEnv';
import { fetchStats, Stats } from '../server/stats';
import { deserialize } from '@/shared/utils/serializer';
import { fetchDaySummaries } from '@/shared/api/server/summary';

export const ExplorePage = async () => {
  // Stats and pairs read pindexer's database; if it is unreachable the page
  // still renders (hero, get-started) instead of the error boundary.
  const statsP = (async () => {
    const raw = await fetchStats();
    return deserialize<Stats>(raw);
  })().catch((err: unknown) => {
    console.warn('[explore] stats unavailable', err);
    return null;
  });
  const summariesP = fetchDaySummaries().catch((err: unknown) => {
    console.warn('[explore] pair summaries unavailable', err);
    return [];
  });
  const registryP = fetchRegistry(getClientSideEnv().PENUMBRA_CHAIN_ID);
  const [stats, summaries, registry] = await Promise.all([statsP, summariesP, registryP]);
  return (
    <section className='mx-auto flex max-w-[1062px] flex-col gap-8 p-4 desktop:gap-10'>
      <PenumbraWaves />
      <ExploreHero />
      {stats && <ExploreStats stats={stats} registry={registry} />}
      <GetStarted />
      <ExplorePairs summaries={summaries} />
    </section>
  );
};

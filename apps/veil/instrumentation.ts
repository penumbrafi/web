/**
 * Runs once when a server instance starts. Computes the CoinGecko markets
 * up front so the first crawl after a deploy is not the one that waits on
 * pd and pindexer. Not awaited: the server must not hold its readiness on
 * an upstream.
 */
export async function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') {
    return;
  }
  const { warmMarkets } = await import('@/shared/api/server/coingecko');
  warmMarkets();
}

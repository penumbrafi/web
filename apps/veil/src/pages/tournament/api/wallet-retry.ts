/**
 * Retry policy for queries that go through the wallet's ViewService.
 *
 * Those calls fail transiently while the extension (re)starts its penumbra
 * services — e.g. Zafu answers "penumbra network not active" for a moment
 * after a dapp connects while its UI is on another network. React Query's
 * default (3 retries, ~7s) gave up before the wallet was back, leaving the
 * rewards panel on a skeleton. This allows ~25s before surfacing an error.
 */
export const walletQueryRetry = {
  retry: 5,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10_000),
};

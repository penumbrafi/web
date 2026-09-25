import type { Keplr } from '@keplr-wallet/types';
import { KeplrClient, KeplrExtensionWallet, keplrExtensionInfo } from '@cosmos-kit/keplr-extension';

/**
 * Zafu as a Cosmos wallet in cosmos-kit, next to Keplr and Leap.
 *
 * Zafu injects its own Keplr-shaped provider at `window.zafu`, always on and
 * on its own slot, so it never competes with a real Keplr for
 * `window.keplr` (its Keplr impersonation there is opt-in and off by
 * default). It implements the Keplr methods cosmos-kit's KeplrClient calls,
 * so the Keplr adapter is reused with only the provider lookup swapped.
 *
 * Not offered for Injective: see `supportedChains`.
 */
const findZafu = async (): Promise<Keplr | undefined> => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const get = () => (window as unknown as { zafu?: Keplr }).zafu;
  if (get() || document.readyState === 'complete') {
    return get();
  }
  // Content scripts may inject after our bundle runs; wait for load once.
  await new Promise<void>(resolve => {
    window.addEventListener('load', () => resolve(), { once: true });
  });
  return get();
};

class ZafuExtensionWallet extends KeplrExtensionWallet {
  override async initClient() {
    this.initingClient();
    try {
      const zafu = await findZafu();
      this.initClientDone(zafu ? new KeplrClient(zafu) : undefined);
    } catch (error) {
      this.initClientError(error as Error);
    }
  }
}

export const zafuWallet = new ZafuExtensionWallet({
  ...keplrExtensionInfo,
  name: 'zafu-extension',
  prettyName: 'Zafu',
  logo: '/assets/zafu.png',
  connectEventNamesOnWindow: [],
  // Only the coin-118 chains Zafu serves over this provider. It fails closed
  // on Ethermint chains (Injective): a coin-118 key there would be a
  // plausible but unspendable inj1 address. Its in-wallet flow covers those.
  // cosmos-kit does not enforce this list (the picker still shows Zafu on
  // Injective); the safety is Zafu's refusal, which leaves no address set.
  supportedChains: ['noble', 'cosmoshub', 'osmosis'],
  mobileDisabled: true,
  downloads: [],
});

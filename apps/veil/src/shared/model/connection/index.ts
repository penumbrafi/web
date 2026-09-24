import {
  PenumbraRequestFailure,
  PenumbraState,
  PenumbraManifest,
  PenumbraClient,
} from '@penumbra-zone/client';
import { makeAutoObservable } from 'mobx';
import { openToast } from '@penumbra-zone/ui/Toast';
import { penumbra } from '@/shared/const/penumbra';
import { ViewService } from '@penumbra-zone/protobuf';
import { ClientEnv } from '@/shared/api/env/types';
import { queryClient } from '@/shared/const/queryClient';

const SUBACCOUNT_LS_KEY = 'veil-connection-subaccount';

class ConnectionStateStore {
  connected = false;
  connectedLoading = true;
  clientEnv: ClientEnv | undefined;
  manifest: PenumbraManifest | undefined;
  /**
   * True when the wallet extension is present + our origin is granted but
   * the extension itself is locked (no password entered since it started).
   * ViewService calls throw `[unauthenticated]` in this state and the
   * frontend would otherwise spin forever on `statusStore.setup` waiting
   * for a status that will never come. Consumers use this to show a
   * "click the extension icon and unlock" banner instead of a loading
   * bar. Auto-clears once a call succeeds again (`markWalletUnlocked`).
   */
  walletLocked = false;

  /** Index of the selected subaccount */
  subaccount = 0;

  /** True while a connect request is waiting on the wallet. */
  connecting = false;

  /**
   * The one connect request in flight. Every click while the wallet is
   * still showing its approval reuses it: a second penumbra.connect() used
   * to send the wallet a second approval request (a second side panel or
   * popup), and whichever resolved last won.
   */
  private connectInFlight: Promise<void> | undefined;

  constructor() {
    makeAutoObservable(this);
  }

  private setManifest(manifest: PenumbraManifest | undefined) {
    this.manifest = manifest;
  }

  private setConnected(connected: boolean) {
    this.connected = connected;
  }

  /**
   * Listeners fired on the false-edge of `walletLocked` (i.e. when the
   * wallet has JUST been detected unlocked after a period of being
   * locked). Consumers register here to resume work that couldn't run
   * while the extension held [unauthenticated] — most importantly the
   * order form's gas-fee estimator and every ViewService-backed query
   * that stalled on empty/errored results. Without this, when a user
   * unlocks the wallet mid-session, the banner clears but the sync bar
   * stays "loading" or gas stays "--" until the user edits something
   * that trips a fresh fetch by side-effect.
   */
  private unlockListeners = new Set<() => void>();

  onWalletUnlock(listener: () => void): () => void {
    this.unlockListeners.add(listener);
    return () => this.unlockListeners.delete(listener);
  }

  markWalletLocked() {
    if (!this.walletLocked) this.walletLocked = true;
  }

  markWalletUnlocked() {
    if (!this.walletLocked) return;
    this.walletLocked = false;
    // Fire outside the current microtask so mobx observers see the
    // false state before consumers fetch — otherwise a listener that
    // inspects `walletLocked` synchronously would still read `true`.
    queueMicrotask(() => {
      for (const fn of this.unlockListeners) {
        try {
          fn();
        } catch (err) {
          console.warn('[connection] unlock listener threw', err);
        }
      }
    });
  }

  setSubaccount = (subaccount: string) => {
    this.subaccount = parseInt(subaccount, 10) || 0;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SUBACCOUNT_LS_KEY, subaccount);
    }
  };

  setPreferredSubaccount = () => {
    if (typeof window === 'undefined') return;
    const subaccount = window.localStorage.getItem(SUBACCOUNT_LS_KEY);
    if (subaccount) {
      this.setSubaccount(subaccount);
    }
  };

  async reconnect() {
    const providers = PenumbraClient.getProviders();
    const connected = Object.keys(providers).find(origin =>
      PenumbraClient.isProviderConnected(origin),
    );

    if (!connected) {
      return;
    }

    try {
      await penumbra.connect(connected);
      this.setConnected(true);
      await this.checkWrongChain();
      this.setPreferredSubaccount();
    } catch (error) {
      console.warn(error);
      /* no-op */
    }
  }

  private setConnecting(connecting: boolean) {
    this.connecting = connecting;
  }

  connect(provider: string): Promise<void> {
    this.connectInFlight ??= this.runConnect(provider).finally(() => {
      this.connectInFlight = undefined;
      this.setConnecting(false);
    });
    return this.connectInFlight;
  }

  private async runConnect(provider: string) {
    this.setConnecting(true);
    // If the extension never resolves the request (its approval UI never
    // appeared), penumbra.connect() just hangs. After a while, tell the
    // user where to look - but keep waiting: they may simply be typing
    // their password, and giving up here (the old 8s hard timeout) showed
    // "didn't respond" mid-approval and invited a second click, which sent
    // a second request.
    const SLOW_MS = 15_000;
    const slowTimer = setTimeout(() => {
      openToast({
        type: 'info',
        message: 'Waiting for your wallet',
        description:
          'Approve the connection in the wallet. If nothing opened, click the wallet icon in the browser toolbar.',
      });
    }, SLOW_MS);
    try {
      await penumbra.connect(provider);
      this.setPreferredSubaccount();
      // Don't hold the connect spinner on the chain check: it goes through
      // the wallet's view service, which can take seconds while the wallet
      // syncs. A wrong chain still alerts and disconnects when it resolves.
      void this.checkWrongChain().catch((error: unknown) => console.warn(error));
    } catch (error) {
      if (error instanceof Error && error.cause) {
        if (error.cause === PenumbraRequestFailure.Denied) {
          openToast({
            type: 'error',
            message: 'Connection denied',
            description: 'You may need to un-ignore this site in your extension settings.',
          });
        }
        if (error.cause === PenumbraRequestFailure.NeedsLogin) {
          openToast({
            type: 'error',
            message: 'Not logged in',
            description: 'Please login into the extension and try again.',
          });
        }
      }
    } finally {
      clearTimeout(slowTimer);
    }
  }

  async disconnect() {
    if (!penumbra.connected) {
      return;
    }

    try {
      await penumbra.disconnect();
      localStorage.removeItem(SUBACCOUNT_LS_KEY);
    } catch (error) {
      console.error(error);
    } finally {
      // Clear wallet state in place instead of reloading the whole page.
      // resetQueries drops cached wallet data (balances, positions, …) and
      // refetches the active public queries; wallet queries stay empty
      // because they are gated on `connected`.
      this.setSubaccount('0');
      this.setConnected(false);
      void queryClient.resetQueries();
    }
  }

  // Checks if the connected wallet's chainId is the same as DEX's chainId. Disconnects if not.
  async checkWrongChain() {
    const [parameters] = await Promise.all([penumbra.service(ViewService).appParameters({})]);

    const walletChainId = parameters.parameters?.chainId;
    const dexChainId = this.clientEnv?.PENUMBRA_CHAIN_ID;

    if (!walletChainId || (dexChainId && walletChainId !== dexChainId)) {
      alert(
        `Connection denied. Your wallet is connected to the wrong chain "${walletChainId}". Please connect to "${dexChainId}".`,
      );
      void this.disconnect();
    }
  }

  async setup(clientEnv: ClientEnv) {
    this.clientEnv = clientEnv;
    this.setManifest(penumbra.manifest);

    penumbra.onConnectionStateChange(event => {
      this.setManifest(penumbra.manifest);
      this.setConnected(event.state === PenumbraState.Connected);
    });

    // If Prax is connected on page load, reconnect to ensure the connection is still active
    await this.reconnect();
    this.connectedLoading = false;
  }
}

export const connectionStore = new ConnectionStateStore();

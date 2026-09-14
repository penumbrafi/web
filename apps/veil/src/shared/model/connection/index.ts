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

const SUBACCOUNT_LS_KEY = 'veil-connection-subaccount';

class ConnectionStateStore {
  connected = false;
  connectedLoading = true;
  clientEnv: ClientEnv | undefined;
  manifest: PenumbraManifest | undefined;

  /** Index of the selected subaccount */
  subaccount = 0;

  constructor() {
    makeAutoObservable(this);
  }

  private setManifest(manifest: PenumbraManifest | undefined) {
    this.manifest = manifest;
  }

  private setConnected(connected: boolean) {
    this.connected = connected;
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

  async connect(provider: string) {
    // If the extension never resolves the request — its service worker
    // received our message but silently declined to open its approval
    // sidebar, or the MV3 gesture window elapsed before it could —
    // penumbra.connect() just hangs. Bound the wait so the user gets
    // a toast instead of a stuck click; the real fix belongs on the
    // wallet side, this is defence-in-depth.
    const CONNECT_TIMEOUT_MS = 8_000;
    const NO_RESPONSE = 'ZAFU_NO_RESPONSE';
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        penumbra.connect(provider),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(NO_RESPONSE)), CONNECT_TIMEOUT_MS);
        }),
      ]);
      await this.checkWrongChain();
      this.setPreferredSubaccount();
    } catch (error) {
      if (error instanceof Error && error.message === NO_RESPONSE) {
        openToast({
          type: 'error',
          message: "Wallet didn't respond",
          description:
            'Open the wallet extension manually (click its icon in the browser toolbar), unlock it, then try connecting again.',
        });
        return;
      }
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
      if (timeoutId !== undefined) clearTimeout(timeoutId);
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
      window.location.reload();
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

import { ViewService } from '@penumbra-zone/protobuf';
import { penumbra } from '@/shared/const/penumbra';
import { getSyncPercent } from '@/shared/model/status/getSyncPercent';
import { makeAutoObservable, runInAction, when } from 'mobx';
import {
  StatusResponse,
  StatusStreamResponse,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { connectionStore } from '@/shared/model/connection';

class StatusState {
  /** If true, ignore all other state values */
  loading = true;
  /** The error is set in case of a request failure */
  error?: string;
  /** Indicates that the account needs syncing with the blockchain */
  syncing = false;
  /** Indicates that the account is almost in sync with the blockchain (amount of unsynced blocks is less than 10) */
  updating?: boolean = false;
  /** The amount of synced blocks */
  fullSyncHeight = 0n;
  /** The total amount of blocks in the blockchain */
  latestKnownBlockHeight?: bigint;
  /** A number between 0 and 1 indicating the sync progress */
  syncPercent = 0;
  /** A stringified sync percentage, e.g. '100%' or '17%' */
  syncPercentStringified = '0%';

  constructor() {
    makeAutoObservable(this);

    when(
      () => connectionStore.connected,
      () => void this.setup(),
    );
  }

  async setup() {
    try {
      const status = await penumbra.service(ViewService).status({});
      // First success after a period of [unauthenticated] means the
      // extension is unlocked again — clear the flag so the wallet-locked
      // banner disappears automatically without a page reload.
      connectionStore.markWalletUnlocked();
      this.setUnaryStatus(status);

      const stream = penumbra.service(ViewService).statusStream({});
      for await (const status of stream) {
        this.setStreamedStatus(status);
      }
    } catch (error) {
      const isLocked =
        error instanceof Error && /\[unauthenticated\]/i.test(error.message);
      runInAction(() => {
        this.error = error instanceof Error ? `${error.name}: ${error.message}` : 'Streaming error';
        // Stop showing the sync-bar's indeterminate loading state — it
        // would otherwise sit at 0% "loading" forever. `loading=false`
        // hands control to the wallet-locked banner, which is a
        // meaningful signal the user can act on.
        if (isLocked) this.loading = false;
      });
      if (isLocked) {
        connectionStore.markWalletLocked();
      }
      // Longer retry interval when locked — polling every 1s to
      // discover we're still locked is wasted noise. The user needs to
      // physically click the extension icon and enter a password;
      // 3s is plenty snappy for detecting the unlock.
      setTimeout(() => void this.setup(), isLocked ? 3000 : 1000);
    }
  }

  setUnaryStatus(status: StatusResponse) {
    this.loading = false;
    this.error = undefined;
    this.syncing = status.catchingUp;
    this.fullSyncHeight = status.fullSyncHeight;
    this.latestKnownBlockHeight = status.catchingUp ? undefined : status.fullSyncHeight;
    this.syncPercent = status.catchingUp ? 0 : 1;
    this.syncPercentStringified = status.catchingUp ? '0%' : '100%';
  }

  setStreamedStatus(status: StatusStreamResponse) {
    this.loading = false;
    this.error = undefined;
    this.syncing = status.fullSyncHeight !== status.latestKnownBlockHeight;
    this.fullSyncHeight = status.fullSyncHeight;
    this.latestKnownBlockHeight = status.latestKnownBlockHeight;
    const { syncPercent, syncPercentStringified } = getSyncPercent(
      status.fullSyncHeight,
      status.latestKnownBlockHeight,
    );
    this.syncPercent = syncPercent;
    this.syncPercentStringified = syncPercentStringified;
  }
}

export const statusStore = new StatusState();

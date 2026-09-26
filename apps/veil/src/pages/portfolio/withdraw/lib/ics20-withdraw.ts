// ICS-20 withdrawal helpers shared between the per-row Unshield dialog
// (`pages/portfolio/ui/unshield-dialog.tsx`) and the dedicated
// `/portfolio/withdraw` flow (`pages/portfolio/withdraw/*`).
//
// This module intentionally contains ONLY the pure helpers + the
// `sendIbcOut` planner call — no React, no UI copy — so the CEX-style
// withdraw page doesn't accidentally pull the whole per-row dialog
// component (and its `@penumbra-zone/ui/Dialog` + `AssetSelector`
// imports) into its bundle just to reuse the transaction-planning
// logic. The dialog file re-exports these for backwards compat and
// keeps its user-facing helpers (`amountMoreThanBalance`) local.

import {
  getDisplayDenomExponentFromValueView,
  getMetadata,
} from '@penumbra-zone/getters/value-view';
import {
  BalancesResponse,
  TransactionPlannerRequest,
} from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { toBaseUnit } from '@penumbra-zone/types/lo-hi';
import BigNumber from 'bignumber.js';
import { ViewService } from '@penumbra-zone/protobuf/penumbra/view/v1/view_connect';
import { getAddressIndex } from '@penumbra-zone/getters/balances-response';
import { Channel } from '@penumbra-zone/protobuf/ibc/core/channel/v1/channel_pb';
import { ClientState } from '@penumbra-zone/protobuf/ibc/lightclients/tendermint/v1/tendermint_pb';
import { IbcChannelService, IbcClientService, IbcConnectionService } from '@penumbra-zone/protobuf';
import { Height } from '@penumbra-zone/protobuf/ibc/core/client/v1/client_pb';
import { bech32, bech32m } from 'bech32';
import { Chain } from '@penumbrafi/registry';
import { fromValueView } from '@penumbra-zone/types/amount';

import { penumbra } from '@/shared/const/penumbra';
import { planBuildBroadcast } from '@/entities/transaction';
import type { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets.ts';

const APPROX_BLOCK_DURATION_MS = 5_500n;
const MINUTE_MS = 60_000n;
export const BLOCKS_PER_MINUTE = MINUTE_MS / APPROX_BLOCK_DURATION_MS;
export const BLOCKS_PER_HOUR = BLOCKS_PER_MINUTE * 60n;

const tenMinsMs = 1000 * 60 * 10;
const twoDaysMs = 1000 * 60 * 60 * 24 * 2;

// Timeout is two days. Rounded up to the nearest 10 minute interval to
// prevent identifying a submitter by their local clock skew.
// Reference in core:
// https://github.com/penumbra-zone/penumbra/blob/1376d4b4f47f44bcc82e8bbdf18262942edf461e/crates/bin/pcli/src/command/tx.rs#L1066-L1067
export const currentTimePlusTwoDaysRounded = (currentTimeMs: number): bigint => {
  const twoDaysFromNowMs = currentTimeMs + twoDaysMs;
  const roundedTimeoutMs = twoDaysFromNowMs + tenMinsMs - (twoDaysFromNowMs % tenMinsMs);
  return BigInt(roundedTimeoutMs) * 1_000_000n;
};

export const clientStateForChannel = async (channel?: Channel): Promise<ClientState> => {
  const connectionId = channel?.connectionHops[0];
  if (!connectionId) {
    throw new Error('no connectionId in channel returned from ibcChannelClient request');
  }

  const { connection } = await penumbra.service(IbcConnectionService).connection({
    connectionId,
  });
  const clientId = connection?.clientId;
  if (!clientId) {
    throw new Error('no clientId ConnectionEnd returned from ibcConnectionClient request');
  }

  const { clientState: anyClientState } = await penumbra
    .service(IbcClientService)
    .clientState({ clientId });
  if (!anyClientState) {
    throw new Error(`Could not get state for client id ${clientId}`);
  }

  const clientState = new ClientState();
  const success = anyClientState.unpackTo(clientState);
  if (!success) {
    throw new Error(`Error while trying to unpack Any to ClientState for client id ${clientId}`);
  }

  return clientState;
};

// Reference in core:
// https://github.com/penumbra-zone/penumbra/blob/1376d4b4f47f44bcc82e8bbdf18262942edf461e/crates/bin/pcli/src/command/tx.rs#L998-L1050
export const getTimeout = async (
  ibcChannelId: string,
): Promise<{ timeoutTime: bigint; timeoutHeight: Height }> => {
  const { channel } = await penumbra.service(IbcChannelService).channel({
    portId: 'transfer',
    channelId: ibcChannelId,
  });

  const clientState = await clientStateForChannel(channel);
  if (!clientState.latestHeight) {
    throw new Error(`latestHeight not provided in client state for ${clientState.chainId}`);
  }

  return {
    timeoutTime: currentTimePlusTwoDaysRounded(Date.now()),
    timeoutHeight: new Height({
      revisionHeight: clientState.latestHeight.revisionHeight + BLOCKS_PER_HOUR * 3n,
      revisionNumber: clientState.latestHeight.revisionNumber,
    }),
  };
};

/**
 * Plans, builds, and broadcasts an `ics20Withdrawal` (unshield) transaction.
 * `amount` is in DISPLAY units (e.g. "1.25" INJ, not raw base units).
 * `channelId` defaults to the channel in the asset's denom trace; pass it for
 * a native asset like UM, which has no trace and can leave over any channel.
 */
export async function sendIbcOut(
  asset: ShieldedBalance,
  amount: string,
  destAddress: string,
  channelId?: string,
) {
  const addressIndex = getAddressIndex(asset.balance);
  const { address: returnAddress } = await penumbra
    .service(ViewService)
    .ephemeralAddress({ addressIndex });
  if (!returnAddress) {
    throw new Error('Error with generating IBC deposit address');
  }

  const denom = getMetadata(asset.valueView).base;
  const sourceChannel = channelId ?? denom.split('/')[1] ?? '';
  const { timeoutHeight, timeoutTime } = await getTimeout(sourceChannel);

  const req = new TransactionPlannerRequest({
    ics20Withdrawals: [
      {
        amount: toBaseUnit(
          BigNumber(amount),
          getDisplayDenomExponentFromValueView(asset.valueView),
        ),
        denom: { denom },
        destinationChainAddress: destAddress,
        returnAddress,
        timeoutHeight,
        timeoutTime,
        sourceChannel,
      },
    ],
    source: addressIndex,
  });
  return await planBuildBroadcast('ics20Withdrawal', req);
}

/**
 * Matches the given address to the chain's address prefix.
 * We don't know what format foreign addresses are in, so this only checks:
 * - it's valid bech32 OR valid bech32m
 * - the prefix matches the chain
 */
export function unknownAddrIsValid(chain: Chain | undefined, address: string): boolean {
  if (!chain || address === '') {
    return false;
  }
  const { prefix, words } =
    bech32.decodeUnsafe(address, Infinity) ?? bech32m.decodeUnsafe(address, Infinity) ?? {};
  return !!words && prefix === chain.addressPrefix;
}

export function amountMoreThanBalance(
  asset: BalancesResponse,
  /** display denomination (e.g. `penumbra`, not `upenumbra`) */
  amountInDisplayDenom: string,
): boolean {
  if (!asset.balanceView) {
    throw new Error('Missing balanceView');
  }

  const balanceAmt = fromValueView(asset.balanceView);
  return Boolean(amountInDisplayDenom) && BigNumber(amountInDisplayDenom).gt(balanceAmt);
}

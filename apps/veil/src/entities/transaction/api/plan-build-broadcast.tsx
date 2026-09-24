import Link from 'next/link';
import { TransactionPlannerRequest } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { ViewService } from '@penumbra-zone/protobuf';
import {
  Transaction,
  TransactionPlan,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { PartialMessage } from '@bufbuild/protobuf';
import { openToast } from '@penumbra-zone/ui/Toast';
import {
  TransactionClassification,
  TRANSACTION_LABEL_BY_CLASSIFICATION,
} from '@/shared/utils/transaction-classify';
import { uint8ArrayToHex } from '@penumbra-zone/types/hex';
import { shorten } from '@penumbra-zone/types/string';
import { penumbra } from '@/shared/const/penumbra';
import { txToId } from '../model/tx-to-id';
import { getBroadcastStatusMessage, getBuildStatusDescription } from '../model/status';
import { describeTxError } from '../model/describe-error';
import { planTransaction } from './plan';
import { broadcastTransaction } from './broadcast';
import { buildTransaction } from './build';
import { veilBroadcastTransaction, VeilBroadcastTerminalError } from './veil-broadcast';
import { readBroadcastMode } from '@/shared/model/broadcast-mode';
import { queryClient } from '@/shared/const/queryClient';

/**
 * Every landed tx changes balances, and history. Refresh them here, once,
 * instead of trusting each caller to remember: withdraw didn't, which is
 * how Veil kept showing 10 USDC.inj after 5 had already left. Cosmos
 * balances too, since a withdrawal lands there.
 */
const refreshAfterTx = () => {
  for (const key of [
    'view-service-balances',
    'cosmos-balances',
    'txs',
    'walletAssets',
    'positions',
    'view-service-delegations',
    'view-service-unbonding-tokens',
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
};

/**
 * Extra information the outer caller (e.g. OrderFormStore.submit) needs
 * to make follow-up decisions safely — most importantly, whether the
 * wallet's LOCAL view service has observed the tx, so a swapClaim
 * planner call won't hit "Swap record not found" and mislead the user
 * into a double-broadcast.
 */
export interface PlanBuildBroadcastResult {
  transaction: Transaction;
  /**
   * `true` when the local view service has scanned the block containing
   * this tx. Only meaningful for `awaitDetection: true` paths. When
   * `false`, do NOT plan any follow-up transaction that spends a note this
   * one produced — the planner will throw because the note isn't visible
   * yet. veil no longer issues swapClaims (the wallet owns those), so today
   * this is advisory for callers adding new dependent flows.
   */
  viewSeen: boolean;
}

/**
 * Handles the common use case of planning, building, and broadcasting a
 * transaction, along with the appropriate toasts. Throws with the
 * mapped `DescribedError` shape when something fails (only cancellations
 * are swallowed and reported as a warning toast) so consuming code can
 * distinguish success, cancellation, and failure — critically, it can
 * see `txAlreadyOnChain: true` when the tx landed but the follow-up
 * step failed, and skip a resubmit that would broadcast a second tx.
 */
export const planBuildBroadcast = async (
  transactionClassification: TransactionClassification,
  req: PartialMessage<TransactionPlannerRequest>,
  options?: {
    /**
     * If set to `true`, the `ViewService#witnessAndBuild` method will be used,
     * which does not prompt the user to authorize the transaction. If `false`,
     * the `ViewService#authorizeAndBuild` method will be used, which _does_
     * prompt the user to authorize the transaction. (This is required in the
     * case of most transactions.) Default: `false`
     */
    skipAuth?: boolean;
    /**
     * Runs on the plan before the wallet is asked to sign. Throw to abort.
     * Use it when the planner can "succeed" with a plan that doesn't do what
     * the user asked, e.g. a delegator vote with no eligible notes plans a
     * fee-only transaction that votes nothing.
     */
    validatePlan?: (plan: TransactionPlan) => void;
  },
): Promise<PlanBuildBroadcastResult | undefined> => {
  const label =
    transactionClassification in TRANSACTION_LABEL_BY_CLASSIFICATION
      ? TRANSACTION_LABEL_BY_CLASSIFICATION[transactionClassification]
      : '';

  const toast = openToast({
    type: 'loading',
    message: `Building ${label} transaction`,
    dismissible: false,
    persistent: true,
  });

  const rpcMethod = options?.skipAuth
    ? penumbra.service(ViewService).witnessAndBuild
    : penumbra.service(ViewService).authorizeAndBuild;

  try {
    const transactionPlan = await planTransaction(req);
    options?.validatePlan?.(transactionPlan);

    const transaction = await buildTransaction({ transactionPlan }, rpcMethod, status => {
      toast.update({
        description: getBuildStatusDescription(status),
      });
    });

    const txHash = uint8ArrayToHex((await txToId(transaction)).inner);
    const shortenedTxHash = shorten(txHash, 8);

    const broadcastMode = readBroadcastMode();
    let detectionHeight: bigint | undefined;
    let viewSeen = false;
    if (broadcastMode === 'veil') {
      try {
        toast.update({
          type: 'success',
          message: `Emitting ${label} transaction via Veil`,
          description: shortenedTxHash,
        });
        const result = await veilBroadcastTransaction(transaction, {
          awaitDetection: true,
          onBroadcastSuccess: () =>
            toast.update({
              type: 'success',
              message: `${label} submitted — confirmation will appear on next block`,
              description: shortenedTxHash,
            }),
        });
        detectionHeight = result.detectionHeight;
        viewSeen = result.viewSeen;
      } catch (veilErr) {
        // ONLY fall back to the wallet on transport-level failures. A
        // tendermint rejection or a hash-mismatch is terminal — the tx
        // either landed as-is (or in tendermint's cache as such) or was
        // rejected outright, and re-broadcasting the same bytes would
        // either double-broadcast a landed tx or repeat the rejection.
        if (veilErr instanceof VeilBroadcastTerminalError) {
          throw veilErr;
        }
        console.warn('veil-broadcast failed, falling back to wallet:', veilErr);
        toast.update({
          type: 'loading',
          message: `Veil broadcast failed, retrying via wallet`,
          description: shortenedTxHash,
        });
        ({ detectionHeight } = await broadcastTransaction(
          { transaction, awaitDetection: true },
          status =>
            toast.update({
              type: 'success',
              message: getBroadcastStatusMessage(label, status),
              description: shortenedTxHash,
            }),
        ));
        // The wallet-path awaits its own detection; if we got past the
        // await without throwing, the wallet has scanned the tx.
        viewSeen = true;
      }
    } else {
      ({ detectionHeight } = await broadcastTransaction(
        { transaction, awaitDetection: true },
        status =>
          toast.update({
            type: 'success',
            message: getBroadcastStatusMessage(label, status),
            description: shortenedTxHash,
          }),
      ));
      viewSeen = true;
    }

    refreshAfterTx();
    // Only claim success once something actually saw the tx on chain.
    // veil-broadcast can return without the wallet having scanned it
    // (viewSeen false); saying "succeeded" then is a guess.
    toast.update({
      type: 'success',
      message: viewSeen ? `${label} transaction confirmed` : `${label} transaction submitted`,
      description: viewSeen
        ? `Transaction ${shortenedTxHash} is on chain${detectionHeight ? ` at height ${detectionHeight}` : ''}.`
        : `Transaction ${shortenedTxHash} was accepted. Your balance updates once your wallet sees it.`,
      action: {
        label: <Link href={`/explore/tx/${txHash}`}>See details</Link>,
        onClick: () => {},
      },
      dismissible: true,
      persistent: false,
    });

    return { transaction, viewSeen };
  } catch (e) {
    console.error(e);
    // Every failure path funnels through one mapper, so a planner rejection,
    // a pd stateless check and a locked extension all arrive as a sentence
    // the user can act on rather than as `String(e)` — which used to surface
    // raw Connect/anyhow text like "[invalid_argument] initial reserves must
    // provision some amount of either asset".
    const described = describeTxError(e);
    toast.update({
      type: described.cancelled ? 'warning' : described.txAlreadyOnChain ? 'warning' : 'error',
      message: described.title,
      description: described.description,
      dismissible: true,
      persistent: false,
    });
    // RETHROW for anything that isn't a user cancellation, so the caller
    // (OrderFormStore.submit) can react — in particular, it must see
    // `txAlreadyOnChain: true` and NOT let the user resubmit. Previously
    // this catch swallowed everything and returned undefined, which
    // silently voided the double-swap guard: `_submitting` cleared,
    // canSubmit went true, one more click = second on-chain swap.
    if (!described.cancelled) {
      // Attach the described metadata to the error itself so the caller
      // gets the mapped shape without having to re-map.
      const withDescribed = e instanceof Error ? e : new Error(String(e));
      (withDescribed as Error & { described?: typeof described }).described = described;
      throw withDescribed;
    }
  }

  return undefined;
};

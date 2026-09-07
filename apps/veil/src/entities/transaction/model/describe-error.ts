/**
 * Turn a transaction failure into something a trader can act on.
 *
 * Errors reaching the UI come from three layers, none of which is written for
 * a human reader: gRPC/Connect wraps everything as
 * "[invalid_argument] <message>", the view service's planner speaks in notes
 * and iterations, and pd's stateless checks are Rust `anyhow!` strings about
 * reserves and trading-function coefficients. Showing `String(e)` — which is
 * what we did — means the user reads
 *
 *   "ConnectError: [invalid_argument] initial reserves must provision some
 *    amount of either asset"
 *
 * and has no idea that the fix is "increase the amount, or open fewer
 * positions". Each entry below maps a *real* string emitted by pd, the view
 * service, or the wasm planner (grepped from the sources, not invented) onto a
 * title, a plain-language description, and the recovery step.
 */
export interface DescribedError {
  /** Short toast headline. */
  title: string;
  /** What went wrong, in plain language. */
  description: string;
  /** Whether the user cancelled, so we can report it neutrally. */
  cancelled?: boolean;
}

interface Rule {
  /** Matched case-insensitively against the raw error text. */
  match: RegExp;
  title: string;
  description: string;
  cancelled?: boolean;
}

const RULES: Rule[] = [
  // -- user / extension state ------------------------------------------------
  {
    match: /\[permission_denied\]|user denied|request denied/i,
    title: 'Transaction canceled',
    description: 'You declined the request in your wallet. Nothing was submitted.',
    cancelled: true,
  },
  {
    match: /\[unauthenticated\]/i,
    title: 'Wallet is locked',
    description: 'Unlock your Penumbra wallet extension and try again.',
  },
  {
    match: /PenumbraNotInstalledError|provider not available|PenumbraProviderNotAvailable/i,
    title: 'No wallet detected',
    description:
      'Install and enable a Penumbra wallet (Prax or Zafu), then reload this page and reconnect.',
  },
  {
    match: /PenumbraProviderNotConnected|not connected/i,
    title: 'Wallet not connected',
    description: 'Connect your wallet, then submit the order again.',
  },

  // -- planner: funds and notes ---------------------------------------------
  {
    match: /ran out of notes to spend while planning transaction/i,
    title: 'Not enough funds',
    description:
      'Your shielded balance does not cover this order plus its transaction fee. Reduce the amount, or leave some UM spare for gas. Your inputs have been kept.',
  },
  {
    match: /insufficient funds/i,
    title: 'Not enough funds',
    description: 'The amount exceeds your available balance. Reduce it and try again.',
  },
  {
    match: /failed to plan transaction after 100 iterations/i,
    title: 'Could not assemble the transaction',
    description:
      'Your balance is spread across too many small notes to cover this amount. Try a smaller order, or consolidate by sending funds to yourself first.',
  },

  // -- pd: position stateless checks ----------------------------------------
  {
    match: /initial reserves must provision some amount of either asset/i,
    title: 'Position amount is too small',
    description:
      'After splitting your liquidity across the range, at least one position had nothing in it. Increase the amount, or reduce the number of positions.',
  },
  {
    match: /trading function coefficients must be nonzero/i,
    title: 'Price is out of range',
    description:
      'The chosen price cannot be represented on-chain — it is too close to zero, or too extreme for this pair. Move the price nearer the market mid.',
  },
  {
    match: /trading function coefficients are too large|Reserve amounts are out-of-bounds/i,
    title: 'Amount or price is out of range',
    description:
      'This position exceeds the limits the chain accepts. Reduce the amount, or narrow the price range.',
  },
  {
    match: /fee cannot be greater than 50%/i,
    title: 'Fee tier too high',
    description: 'A position fee cannot exceed 50%. Lower the fee tier and try again.',
  },
  {
    match: /cyclical pairs aren't allowed|Trading pair must be distinct/i,
    title: 'Invalid trading pair',
    description: 'A position must be between two different assets. Pick a different pair.',
  },
  {
    match: /Dex MUST be enabled to open positions/i,
    title: 'DEX is disabled',
    description:
      'The chain currently has the DEX turned off, so no new positions can be opened. This is a governance setting, not a problem with your order.',
  },
  {
    match: /could not find position .* to close|withdrew from unknown position/i,
    title: 'Position no longer exists',
    description:
      'This position has already been closed or withdrawn. Refresh your positions to see the current state.',
  },
  {
    match: /fee token .* not recognized by the chain/i,
    title: 'Unsupported fee asset',
    description: 'The chain will not accept gas in this asset. Keep some UM available for fees.',
  },

  // -- swap ------------------------------------------------------------------
  {
    match: /No input value for swap/i,
    title: 'No amount to swap',
    description: 'Enter an amount before submitting.',
  },
  {
    match: /error filling route/i,
    title: 'Not enough liquidity',
    description:
      'There is not enough liquidity on this route to fill your order. Try a smaller size, or a different pair.',
  },

  // -- transport -------------------------------------------------------------
  {
    match: /\[unavailable\]|\[deadline_exceeded\]|failed to fetch|network ?error/i,
    title: 'Network problem',
    description:
      'Could not reach the chain. Check your connection and your wallet’s RPC endpoint, then try again. Nothing was submitted.',
  },
  {
    match: /\[failed_precondition\].*sync|not fully synced|still syncing/i,
    title: 'Wallet is still syncing',
    description:
      'Your wallet has not caught up with the chain yet, so it cannot see all of your notes. Wait for the sync bar to finish and try again.',
  },
];

/** Strip the layers of wrapping so the rules can see the underlying message. */
const rawText = (e: unknown): string => {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}`;
  }
  return String(e);
};

export const describeTxError = (e: unknown): DescribedError => {
  const text = rawText(e);
  const rule = RULES.find(r => r.match.test(text));

  if (rule) {
    return { title: rule.title, description: rule.description, cancelled: rule.cancelled };
  }

  // Unmapped: still better than a bare protobuf dump. Say plainly that
  // nothing was submitted and that the form is intact, then hand over the
  // raw text so it can be reported.
  return {
    title: 'Transaction failed',
    description: `${text.replace(/^\w*Error:\s*/, '')} — your inputs have been kept, so you can adjust and retry.`,
  };
};

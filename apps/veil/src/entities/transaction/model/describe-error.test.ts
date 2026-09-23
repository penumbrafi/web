import { describe, expect, it } from 'vitest';
import { describeTxError } from './describe-error';

/**
 * The left-hand strings are real messages emitted by pd
 * (crates/core/component/dex/src/lp/position.rs), the view service planner
 * (crates/view/src/planner.rs) and the Connect transport — wrapped the way
 * they actually reach the browser.
 */
describe('describeTxError', () => {
  it('maps the planner "ran out of notes" error to a funds message', () => {
    const e = new Error(
      '[invalid_argument] ran out of notes to spend while planning transaction, need 5 UM',
    );
    const { title, description } = describeTxError(e);
    expect(title).toBe('Not enough funds');
    expect(description).not.toContain('invalid_argument');
    expect(description).toMatch(/gas|fee/i);
  });

  it('maps the zero-reserve position rejection to an actionable size hint', () => {
    const e = new Error(
      '[invalid_argument] initial reserves must provision some amount of either asset',
    );
    const { title, description } = describeTxError(e);
    expect(title).toBe('Position amount is too small');
    expect(description).toMatch(/Increase the amount/);
  });

  it('maps a nonzero-coefficient rejection to a price hint', () => {
    const { title } = describeTxError(
      new Error('[invalid_argument] trading function coefficients must be nonzero'),
    );
    expect(title).toBe('Price is out of range');
  });

  it('reports user denial as a cancellation rather than a failure', () => {
    const { title, cancelled } = describeTxError(
      new Error('[permission_denied] user denied request'),
    );
    expect(cancelled).toBe(true);
    expect(title).toBe('Transaction canceled');
  });

  it('recognises a locked extension', () => {
    expect(describeTxError(new Error('[unauthenticated] not logged in')).title).toBe(
      'Wallet is locked',
    );
  });

  it('recognises a missing provider', () => {
    const e = new Error('provider unavailable');
    e.name = 'PenumbraNotInstalledError';
    expect(describeTxError(e).title).toBe('No wallet detected');
  });

  it('maps transport failures to a network message', () => {
    expect(describeTxError(new Error('[unavailable] failed to fetch')).title).toBe(
      'Network problem',
    );
  });

  it('falls back without dumping a bare Error prefix, and says state is kept', () => {
    const { title, description } = describeTxError(new Error('something entirely new'));
    expect(title).toBe('Transaction failed');
    expect(description).toContain('something entirely new');
    expect(description).toMatch(/inputs have been kept/);
  });

  it('maps a spent-nullifier rejection to a do-not-retry warning', () => {
    // Verbatim from a dev.penumbra.fi console after a duplicate swapClaim.
    const e = new Error(
      'tendermint rejected transaction (code 1): failed to deliver transaction: ' +
        'executing transaction: nullifier ' +
        'da40a69899bc902f4f7452fd27873c3f14c5d45b1a0bf27a1ecde86004bf8f0d was already spent in ' +
        '"2699d4516cdaf522773eb2e315abc06066f3e65bfdad36fdd56412d863371905"',
    );
    e.name = 'VeilBroadcastTerminalError';
    const described = describeTxError(e);
    expect(described.title).toBe('Those funds were already spent');
    // The caller's double-submit guard keys off this; without it the user
    // gets the generic "adjust and retry" fallback, which re-plans against
    // the same stale note and fails identically.
    expect(described.txAlreadyOnChain).toBe(true);
    expect(described.description).not.toMatch(/inputs have been kept/);
  });

  it('handles non-Error throwables', () => {
    expect(describeTxError('plain string').title).toBe('Transaction failed');
  });
});

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

  it('handles non-Error throwables', () => {
    expect(describeTxError('plain string').title).toBe('Transaction failed');
  });
});

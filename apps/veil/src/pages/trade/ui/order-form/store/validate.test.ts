import { describe, expect, it } from 'vitest';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { blockingIssue, validateOrder } from './validate';

const asset = (symbol: string, fill: number, balance?: number): AssetInfo =>
  new AssetInfo(
    new Metadata({ symbol }),
    new AssetId({ inner: new Uint8Array(Array(32).fill(fill)) }),
    6,
    symbol,
    balance,
  );

const UM = asset('UM', 0xaa, 100);
const USDC = asset('USDC', 0xbb, 50);

describe('validateOrder', () => {
  it('asks for an amount when nothing is entered', () => {
    const issue = blockingIssue(validateOrder({ requirements: [], hasPlan: false }));
    expect(issue?.message).toMatch(/Enter an amount/);
  });

  it('passes a fully-funded order', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 10 }],
      hasPlan: true,
    });
    expect(blockingIssue(issues)).toBeUndefined();
  });

  it('names the asset and both amounts when the balance is short', () => {
    const issue = blockingIssue(
      validateOrder({ requirements: [{ asset: USDC, amount: 80 }], hasPlan: true }),
    );
    expect(issue?.message).toContain('USDC');
    expect(issue?.message).toContain('80');
    expect(issue?.message).toContain('50');
  });

  it('blocks spending the whole fee-asset balance, and says the usable maximum', () => {
    const issue = blockingIssue(
      validateOrder({
        requirements: [{ asset: UM, amount: 100 }],
        feeAsset: UM,
        gasFee: 0.005,
        hasPlan: true,
      }),
    );
    expect(issue?.message).toMatch(/transaction fee/);
    expect(issue?.message).toContain('99.995');
  });

  it('allows spending the fee asset when there is headroom for gas', () => {
    const issues = validateOrder({
      requirements: [{ asset: UM, amount: 99 }],
      feeAsset: UM,
      gasFee: 0.005,
      hasPlan: true,
    });
    expect(blockingIssue(issues)).toBeUndefined();
  });

  it('does not block on an unknown balance — the planner is the authority', () => {
    const unknown = asset('WEIRD', 0xcc, undefined);
    const issues = validateOrder({
      requirements: [{ asset: unknown, amount: 1e9 }],
      hasPlan: true,
    });
    expect(blockingIssue(issues)).toBeUndefined();
  });

  it('explains a missing mid price instead of silently disabling submit', () => {
    const issue = blockingIssue(
      validateOrder({
        requirements: [{ asset: USDC, amount: 1 }],
        hasPlan: true,
        requiresMarketPrice: true,
        marketPrice: undefined,
      }),
    );
    expect(issue?.message).toMatch(/No live market price/);
  });

  it('explains an amount too small to survive the split across positions', () => {
    const issue = blockingIssue(
      validateOrder({
        requirements: [{ asset: USDC, amount: 0.000001 }],
        hasPlan: true,
        positionCount: 0,
      }),
    );
    expect(issue?.message).toMatch(/too small/);
  });

  it('flags a one-sided position as a warning, not a blocker', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 10 }],
      hasPlan: true,
      isOneSided: true,
    });
    expect(blockingIssue(issues)).toBeUndefined();
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toMatch(/One-sided/);
  });
});

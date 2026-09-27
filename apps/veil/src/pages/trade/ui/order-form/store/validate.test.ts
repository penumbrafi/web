import { describe, expect, it } from 'vitest';
import { AssetId, Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { AssetInfo } from '@/pages/trade/model/AssetInfo';
import { blockingIssue, validateOrder } from './validate';
import type { TakeLimitInfo } from './LimitOrderFormStore';

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
    // The realistic shape: every rung rounded to zero, so the plan is an
    // empty array and there are therefore no requirements to report. This
    // must not be reported as "Enter an amount" — the user entered one.
    // with a live mid the likely causes are the bounds or too many positions
    const withMid = blockingIssue(
      validateOrder({ requirements: [], hasPlan: true, positionCount: 0, marketPrice: 1 }),
    );
    expect(withMid?.message).toMatch(/Could not build any positions/);
    expect(withMid?.message).toMatch(/reducing positions/);
    expect(withMid?.message).not.toMatch(/Enter an amount/);

    // without one, the missing anchor is named instead
    const noMid = blockingIssue(
      validateOrder({ requirements: [], hasPlan: true, positionCount: 0 }),
    );
    expect(noMid?.message).toMatch(/no live market price/);
  });

  it('names the funded-but-unquotable side instead of blaming the amount', () => {
    // Range dragged entirely above mid, then a USDC amount typed. Only UM can
    // be quoted up there, so every rung is empty and the plan is []. Without
    // this check the user is told 100 USDC is "too small".
    const issue = blockingIssue(
      validateOrder({
        requirements: [],
        hasPlan: true,
        positionCount: 0,
        wrongSide: { funded: 'quote', baseSymbol: 'UM', quoteSymbol: 'USDC' },
      }),
    );
    expect(issue?.message).toMatch(/entirely above the mid price/);
    expect(issue?.message).toContain('Enter a UM amount');
    expect(issue?.message).not.toMatch(/too small/);
  });

  it('names the mirror case when the range sits below mid', () => {
    const issue = blockingIssue(
      validateOrder({
        requirements: [],
        hasPlan: true,
        positionCount: 0,
        wrongSide: { funded: 'base', baseSymbol: 'UM', quoteSymbol: 'USDC' },
      }),
    );
    expect(issue?.message).toMatch(/entirely below the mid price/);
    expect(issue?.message).toContain('Enter a USDC amount');
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

const take = (over: Partial<TakeLimitInfo> = {}): TakeLimitInfo => ({
  status: 'sized',
  targetPrice: 11.5,
  direction: 'buy',
  baseSymbol: 'UM',
  quoteSymbol: 'USDC',
  ...over,
});

describe('validateOrder in take mode', () => {
  it('passes a sized take', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 50 }],
      hasPlan: true,
      takeLimit: take(),
    });
    expect(blockingIssue(issues)).toBeUndefined();
    expect(issues).toHaveLength(0);
  });

  it('asks for the target before anything else can be said', () => {
    const issue = blockingIssue(
      validateOrder({ requirements: [], hasPlan: false, takeLimit: take({ status: 'idle', targetPrice: 0 }) }),
    );
    expect(issue?.message).toMatch(/Enter a target price/);
  });

  it('explains a missing mid rather than disabling submit silently', () => {
    const issue = blockingIssue(
      validateOrder({ requirements: [], hasPlan: false, takeLimit: take({ status: 'no-mid' }) }),
    );
    expect(issue?.message).toMatch(/nothing to aim from/);
    expect(issue?.message).toMatch(/Rest/);
  });

  it('says the route book is still loading', () => {
    const issue = blockingIssue(
      validateOrder({ requirements: [], hasPlan: false, takeLimit: take({ status: 'loading' }) }),
    );
    expect(issue?.message).toMatch(/route book/);
  });

  it('names the empty side of the book and the way out', () => {
    const issue = blockingIssue(
      validateOrder({
        requirements: [],
        hasPlan: false,
        takeLimit: take({ status: 'empty', direction: 'sell', targetPrice: 9.5 }),
      }),
    );
    expect(issue?.message).toContain('no bids at or above 9.50000 USDC');
    expect(issue?.message).toMatch(/switch to Rest/);
  });

  it('warns — but does not block — when the target is past the whole book', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 10 }],
      hasPlan: true,
      takeLimit: take({ status: 'beyond', targetPrice: 25, worstPrice: 20 }),
    });
    expect(blockingIssue(issues)).toBeUndefined();
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toContain('20.0000 USDC');
  });

  it('still runs the balance checks after a beyond-book warning', () => {
    // The beyond-book note is only a warning; the balance check must still
    // fire behind it (USDC holds 50 here, the order needs 210).
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 210 }],
      hasPlan: true,
      takeLimit: take({ status: 'beyond', targetPrice: 25, worstPrice: 20 }),
    });
    expect(issues.map(i => i.severity)).toEqual(['warning', 'blocking']);
    expect(issues[1]?.message).toContain('USDC');
  });

  it('warns that a capped take only moves the market part of the way', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 30 }],
      hasPlan: true,
      takeLimit: take({ status: 'capped', cappedSymbol: 'USDC' }),
    });
    expect(blockingIssue(issues)).toBeUndefined();
    expect(issues[0]?.message).toContain('balance');
  });

  it('stays quiet when the amount was typed by hand', () => {
    const issues = validateOrder({
      requirements: [{ asset: USDC, amount: 50 }],
      hasPlan: true,
      takeLimit: take({ status: 'manual' }),
    });
    expect(issues).toHaveLength(0);
  });
});

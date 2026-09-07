import { describe, expect, it } from 'vitest';
import {
  Validator,
  ValidatorInfo,
} from '@penumbra-zone/protobuf/penumbra/core/component/stake/v1/stake_pb';
import { IdentityKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { findValidatorInfo, identityKeyOf, stakeGate } from './match-validator';

const validatorInfo = (fill: number): ValidatorInfo =>
  new ValidatorInfo({
    validator: new Validator({
      identityKey: new IdentityKey({ ik: new Uint8Array(Array(32).fill(fill)) }),
    }),
  });

const A = validatorInfo(0xaa);
const B = validatorInfo(0xbb);

describe('identityKeyOf', () => {
  it('round-trips a validator identity key to the bech32m form the explorer uses', () => {
    const key = identityKeyOf(A);
    expect(key).toBe(
      bech32mIdentityKey(new IdentityKey({ ik: new Uint8Array(Array(32).fill(0xaa)) })),
    );
    expect(key?.startsWith('penumbravalid')).toBe(true);
  });

  it('returns undefined rather than throwing on a validator with no identity key', () => {
    expect(identityKeyOf(new ValidatorInfo({}))).toBeUndefined();
  });
});

describe('findValidatorInfo', () => {
  it('matches the right validator by bech32m key', () => {
    const key = identityKeyOf(B);
    expect(findValidatorInfo([A, B], key)).toBe(B);
  });

  it('returns undefined for a key that is not in the set', () => {
    expect(findValidatorInfo([A], identityKeyOf(B))).toBeUndefined();
  });

  it('returns undefined while the list is still loading', () => {
    // The wallet-backed validator list arrives after the server-rendered page,
    // so "not loaded yet" must be distinguishable from "no such validator".
    expect(findValidatorInfo(undefined, identityKeyOf(A))).toBeUndefined();
    expect(findValidatorInfo([], identityKeyOf(A))).toBeUndefined();
  });

  it('returns undefined for a missing key instead of matching arbitrarily', () => {
    expect(findValidatorInfo([A, B], undefined)).toBeUndefined();
  });
});

describe('stakeGate', () => {
  const base = {
    connected: false,
    connectedLoading: false,
    hasValidatorInfo: false,
    hasDelegation: false,
  };

  it('reports checking while the provider handshake is in flight', () => {
    // This is the state the original bug fired in: the page must not decide
    // anything — least of all touch the provider — until setup() resolves.
    expect(stakeGate({ ...base, connectedLoading: true })).toEqual({ kind: 'checking' });
  });

  it('prefers checking over a connect prompt when both could apply', () => {
    expect(stakeGate({ ...base, connectedLoading: true, connected: false }).kind).toBe('checking');
  });

  it('offers to connect when there is no wallet', () => {
    expect(stakeGate(base)).toEqual({ kind: 'connect' });
  });

  it('waits for rate data once connected', () => {
    expect(stakeGate({ ...base, connected: true })).toEqual({ kind: 'loading' });
  });

  it('is ready but delegate-only without a delegation token', () => {
    expect(stakeGate({ ...base, connected: true, hasValidatorInfo: true })).toEqual({
      kind: 'ready',
      canUndelegate: false,
    });
  });

  it('enables undelegate only when a delegation is actually held', () => {
    expect(
      stakeGate({ ...base, connected: true, hasValidatorInfo: true, hasDelegation: true }),
    ).toEqual({ kind: 'ready', canUndelegate: true });
  });

  it('never reaches ready without a connection', () => {
    const gate = stakeGate({ ...base, hasValidatorInfo: true, hasDelegation: true });
    expect(gate.kind).not.toBe('ready');
  });
});

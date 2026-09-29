import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  Action,
  AuthorizationData,
  Transaction,
  TransactionPlan,
  WitnessData,
} from '@penumbra-zone/protobuf/penumbra/core/transaction/v1/transaction_pb';
import { FullViewingKey } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';

const mocks = vi.hoisted(() => ({
  proveParallelWithRayon: vi.fn(),
  buildParallelWithRayon: vi.fn(),
  buildParallel: vi.fn(),
}));

vi.mock('../../offscreen-client.js', () => ({
  offscreenClient: {
    proveParallelWithRayon: mocks.proveParallelWithRayon,
    buildParallelWithRayon: mocks.buildParallelWithRayon,
  },
}));

vi.mock('@penumbrafi/wasm/build', () => ({
  buildParallel: mocks.buildParallel,
}));

const { optimisticParallelBuild } = await import('./build-tx-parallel.js');

const plan = new TransactionPlan({ actions: [{}, {}] });
const witness = new WitnessData();
const fvk = new FullViewingKey();
const authData = new AuthorizationData();
const actions = [new Action(), new Action()];
const tx = new Transaction();

const drain = async (gen: AsyncGenerator) => {
  let last: unknown;
  for await (const msg of gen) {
    last = msg;
  }
  return last;
};

describe('optimisticParallelBuild (prove before approval)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('starts proving before approval and applies auth only after it', async () => {
    const auth = Promise.withResolvers<AuthorizationData>();
    mocks.proveParallelWithRayon.mockResolvedValue(actions);
    mocks.buildParallel.mockResolvedValue(tx);

    const gen = optimisticParallelBuild(plan, witness, auth.promise, fvk);
    const first = await gen.next();
    expect(first.value).toMatchObject({ status: { case: 'buildProgress' } });

    // proving was kicked off while approval is still pending
    expect(mocks.proveParallelWithRayon).toHaveBeenCalledWith(plan, witness, fvk);
    // no auth yet -> nothing assembled/signed
    expect(mocks.buildParallel).not.toHaveBeenCalled();

    auth.resolve(authData);
    const last = await drain(gen);

    expect(mocks.buildParallel).toHaveBeenCalledWith(actions, plan, witness, authData);
    expect(mocks.buildParallelWithRayon).not.toHaveBeenCalled();
    expect(last).toMatchObject({ status: { case: 'complete', value: { transaction: tx } } });
  });

  it('discards proofs and never assembles when approval is denied', async () => {
    mocks.proveParallelWithRayon.mockResolvedValue(actions);
    const denied = Promise.reject(new ConnectError('denied', Code.PermissionDenied));

    await expect(drain(optimisticParallelBuild(plan, witness, denied, fvk))).rejects.toThrow(
      'denied',
    );
    expect(mocks.buildParallel).not.toHaveBeenCalled();
    expect(mocks.buildParallelWithRayon).not.toHaveBeenCalled();
  });

  it('denial while proving is still running does not leave a rejection unhandled', async () => {
    const proving = Promise.withResolvers<Action[]>();
    mocks.proveParallelWithRayon.mockReturnValue(proving.promise);
    const denied = Promise.reject(new ConnectError('denied', Code.PermissionDenied));

    await expect(drain(optimisticParallelBuild(plan, witness, denied, fvk))).rejects.toThrow(
      'denied',
    );
    proving.reject(new Error('late prover failure'));
    await new Promise(r => {
      setTimeout(r, 0);
    });
    expect(mocks.buildParallel).not.toHaveBeenCalled();
  });

  it('falls back to the combined build when prove-only is unsupported', async () => {
    mocks.proveParallelWithRayon.mockRejectedValue(
      new ConnectError('no build_actions_native', Code.Unimplemented),
    );
    mocks.buildParallelWithRayon.mockResolvedValue(tx);

    const last = await drain(
      optimisticParallelBuild(plan, witness, Promise.resolve(authData), fvk),
    );

    expect(mocks.buildParallelWithRayon).toHaveBeenCalledWith(plan, witness, fvk, authData);
    expect(mocks.buildParallel).not.toHaveBeenCalled();
    expect(last).toMatchObject({ status: { case: 'complete', value: { transaction: tx } } });
  });

  it('surfaces real proving errors instead of retrying', async () => {
    mocks.proveParallelWithRayon.mockRejectedValue(new ConnectError('bad witness', Code.Internal));

    await expect(
      drain(optimisticParallelBuild(plan, witness, Promise.resolve(authData), fvk)),
    ).rejects.toThrow('bad witness');
    expect(mocks.buildParallelWithRayon).not.toHaveBeenCalled();
    expect(mocks.buildParallel).not.toHaveBeenCalled();
  });
});

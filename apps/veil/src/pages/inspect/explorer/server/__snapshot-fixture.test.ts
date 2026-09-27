import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Snapshot math against a real pindexer schema.
 *
 * The rows these cases need are not in any deployed indexer — the fixture is
 * `__snapshot-fixture.sql` next to this file, and it is meant for a throwaway
 * database. Point VEIL_FIXTURE_PG at one to run them; without the variable the
 * fixture suite is skipped:
 *
 *     createdb -h 127.0.0.1 -p 55432 veil_snap_fixture
 *     psql -h 127.0.0.1 -p 55432 -d veil_snap_fixture -f __snapshot-fixture.sql
 *     VEIL_FIXTURE_PG=postgresql://postgres@127.0.0.1:55432/veil_snap_fixture \
 *       pnpm vitest run src/pages/inspect/explorer/server/__snapshot-fixture.test.ts
 *
 * The unreachable-endpoint case runs everywhere: it needs no database.
 */
const FIXTURE = process.env['VEIL_FIXTURE_PG'];
const ORIGINAL_ENDPOINT = process.env['PENUMBRA_INDEXER_ENDPOINT'];
if (FIXTURE) {
  process.env['PENUMBRA_INDEXER_ENDPOINT'] = FIXTURE;
}

// Imported only with a fixture endpoint in place: the module reads the
// endpoint (through the shared database client) at import time.
const fixtureModule = FIXTURE ? await import('./validator-chain-snapshot') : null;

describe.skipIf(!FIXTURE)('fetchValidatorChainSnapshots against a real pindexer fixture', () => {
  afterAll(async () => {
    const { pindexerDb } = await import('@/shared/database/client');
    await pindexerDb.destroy();
  });

  it('measures realized APY from the exchange rate over the window', async () => {
    const snapshots = await fixtureModule!.fetchValidatorChainSnapshots();

    // \x05 has no rows in supply_total_staked at all: dropped, not zeroed.
    expect([...snapshots.keys()].sort()).toEqual([
      'penumbravalid1active',
      'penumbravalid1defined',
      'penumbravalid1drained',
      'penumbravalid1jailed',
      'penumbravalid1slashed',
    ]);

    const active = snapshots.get('penumbravalid1active')!;
    expect(active.state).toBe('ACTIVE');
    expect(active.stakeUM).toBe(3_110_000);
    expect(active.windowDays).toBeCloseTo(30, 1);
    expect(active.realizedApyPct!).toBeCloseTo(12.1665, 2);

    // Jailed: the rate is frozen, so the measured rate is a real zero.
    const jailed = snapshots.get('penumbravalid1jailed')!;
    expect(jailed.state).toBe('JAILED');
    expect(jailed.stakeUM).toBe(15_000_000);
    expect(jailed.realizedApyPct).toBe(0);

    // Indexed only inside the window: nothing to measure from.
    const defined = snapshots.get('penumbravalid1defined')!;
    expect(defined.state).toBe('DEFINED');
    expect(defined.realizedApyPct).toBeNull();
    expect(defined.windowDays).toBeNull();

    // Latest rate is 0 (every delegation left): a ratio to 0 is not an APY.
    const drained = snapshots.get('penumbravalid1drained')!;
    expect(drained.state).toBe('ACTIVE');
    expect(drained.stakeUM).toBe(0);
    expect(drained.realizedApyPct).toBeNull();

    // A slash inside the window annualizes to a negative realized rate.
    const slashed = snapshots.get('penumbravalid1slashed')!;
    expect(slashed.realizedApyPct!).toBeCloseTo(-12.1667, 2);
  });
});

describe('fetchValidatorChainSnapshots with an unreachable pindexer', () => {
  afterAll(() => {
    if (ORIGINAL_ENDPOINT === undefined) {
      delete process.env['PENUMBRA_INDEXER_ENDPOINT'];
    } else {
      process.env['PENUMBRA_INDEXER_ENDPOINT'] = ORIGINAL_ENDPOINT;
    }
    vi.resetModules();
  });

  it('returns an empty map', async () => {
    vi.resetModules();
    process.env['PENUMBRA_INDEXER_ENDPOINT'] = 'postgresql://postgres@127.0.0.1:59999/nope';
    const mod = await import('./validator-chain-snapshot');

    const snapshots = await mod.fetchValidatorChainSnapshots();
    expect(snapshots.size).toBe(0);

    const { pindexerDb } = await import('@/shared/database/client');
    await pindexerDb.destroy();
  });
});

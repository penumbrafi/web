import { ChainRegistryClient } from '@penumbrafi/registry';

export const CHAIN_ID = 'penumbra-1';

/** What the dashboard needs to know about an asset. Serializable. */
export interface AssetInfo {
  /** Base64 asset id, the key `insights_shielded_pool.asset_id` maps to. */
  id: string;
  symbol: string;
  /** Display denom (e.g. `penumbra`), or the base denom for fallback entries. */
  display: string;
  /** Base denom (e.g. `upenumbra`). */
  base: string;
  /** Decimal exponent from base units to `display`. 0 when unknown. */
  exponent: number;
  /** False for assets the bundled registry does not know. */
  inRegistry: boolean;
}

/**
 * Structural view of the registry's protobuf `Metadata`. The registry's
 * type declarations import `@penumbra-zone/protobuf`, which this app does
 * not depend on (that would pull the buf codegen chain into the build), so
 * the fields used here are named explicitly instead.
 */
interface RegistryMetadata {
  symbol: string;
  display: string;
  base: string;
  denomUnits: readonly { denom: string; exponent: number }[];
  penumbraAssetId?: { inner: Uint8Array } | undefined;
}

/**
 * Assets that have been shielded on penumbra-1 but are absent from the
 * registry. Base denoms and exponents are known out of band; they still
 * carry `inRegistry: false` so the UI shows the "not in registry" badge.
 */
const FALLBACK: readonly AssetInfo[] = [
  {
    id: 'QArMRIpyiMTawMktm5j53HfLNMrI8TIBQ2wqyCfgtQY=',
    symbol: 'adydx (channel-1)',
    display: 'transfer/channel-1/adydx',
    base: 'transfer/channel-1/adydx',
    exponent: 18,
    inRegistry: false,
  },
  {
    id: '9q1esp3t+R/2MuOJHP42FsAwkFk5Ss5KSJ8qlzN1gws=',
    symbol: 'gamm/pool/1402 (channel-4)',
    display: 'transfer/channel-4/gamm/pool/1402',
    base: 'transfer/channel-4/gamm/pool/1402',
    exponent: 18,
    inRegistry: false,
  },
];

const displayExponent = (m: RegistryMetadata): number => {
  const unit = m.denomUnits.find(u => u.denom === m.display);
  if (unit) {
    return unit.exponent;
  }
  return m.denomUnits.reduce((max, u) => Math.max(max, u.exponent), 0);
};

let table: Map<string, AssetInfo> | undefined;

const buildTable = (): Map<string, AssetInfo> => {
  const map = new Map<string, AssetInfo>();
  const registry = new ChainRegistryClient().bundled.get(CHAIN_ID);
  for (const raw of registry.getAllAssets() as unknown as RegistryMetadata[]) {
    const inner = raw.penumbraAssetId?.inner;
    if (!inner) {
      continue;
    }
    const id = Buffer.from(inner).toString('base64');
    map.set(id, {
      id,
      symbol: raw.symbol || raw.display || id,
      display: raw.display,
      base: raw.base,
      exponent: displayExponent(raw),
      inRegistry: true,
    });
  }
  for (const f of FALLBACK) {
    if (!map.has(f.id)) {
      map.set(f.id, f);
    }
  }
  return map;
};

/** Resolve an asset by base64 id; unknown ids get exponent 0 and the raw id as symbol. */
export const lookupAsset = (id: string): AssetInfo => {
  table ??= buildTable();
  return (
    table.get(id) ?? {
      id,
      symbol: id,
      display: id,
      base: id,
      exponent: 0,
      inRegistry: false,
    }
  );
};

/** Base64 id of the staking token, for the supply chart's scaling. */
export const stakingAsset = (): AssetInfo => {
  const globals = new ChainRegistryClient().bundled.globals() as unknown as {
    stakingAssetId: { inner: Uint8Array };
  };
  return lookupAsset(Buffer.from(globals.stakingAssetId.inner).toString('base64'));
};

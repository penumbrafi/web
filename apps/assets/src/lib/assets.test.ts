import { describe, expect, it } from 'vitest';
import { lookupAsset, stakingAsset } from './assets';

describe('lookupAsset', () => {
  it('resolves UM from the bundled registry with the display exponent', () => {
    const um = lookupAsset('KeqcLzNx9qSH5+lcJHBB9KNW+YPrBk5dKzvPMiypahA=');
    expect(um).toMatchObject({ symbol: 'UM', display: 'penumbra', exponent: 6, inRegistry: true });
    expect(stakingAsset().id).toBe(um.id);
  });

  it('uses the hardcoded fallback for known unregistered 18-decimal assets', () => {
    expect(lookupAsset('QArMRIpyiMTawMktm5j53HfLNMrI8TIBQ2wqyCfgtQY=')).toMatchObject({
      base: 'transfer/channel-1/adydx',
      exponent: 18,
      inRegistry: false,
    });
    expect(lookupAsset('9q1esp3t+R/2MuOJHP42FsAwkFk5Ss5KSJ8qlzN1gws=')).toMatchObject({
      base: 'transfer/channel-4/gamm/pool/1402',
      exponent: 18,
      inRegistry: false,
    });
  });

  it('falls back to the raw id with exponent 0 for anything else', () => {
    const id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    expect(lookupAsset(id)).toEqual({
      id,
      symbol: id,
      display: id,
      base: id,
      exponent: 0,
      inRegistry: false,
    });
  });
});

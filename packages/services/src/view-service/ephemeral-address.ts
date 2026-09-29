import type { Impl } from './index.js';

import { getEphemeralByIndex } from '@penumbrafi/wasm/keys';
import { fvkCtx } from '../ctx/full-viewing-key.js';

export const ephemeralAddress: Impl['ephemeralAddress'] = async (req, ctx) => {
  if (!req.addressIndex) {
    throw new Error('Missing address index');
  }
  const fvk = ctx.values.get(fvkCtx);
  const address = await getEphemeralByIndex(await fvk(), req.addressIndex.account);

  return { address };
};

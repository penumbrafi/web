import type { Impl } from './index.js';

import { getAddressByIndex } from '@penumbrafi/wasm/keys';
import { fvkCtx } from '../ctx/full-viewing-key.js';

export const addressByIndex: Impl['addressByIndex'] = async (req, ctx) => {
  const fvk = ctx.values.get(fvkCtx);
  const address = await getAddressByIndex(
    await fvk(),
    req.addressIndex?.account ?? 0,
    req.addressIndex?.randomizer,
  );
  return { address };
};

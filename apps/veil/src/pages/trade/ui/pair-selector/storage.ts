import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';

const RECENT_STORE_LS_KEY = 'recent-pairs-store';

export const getRecentAssets = (): Metadata[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const data = JSON.parse(window.localStorage.getItem(RECENT_STORE_LS_KEY) ?? '[]') as string[];
    return data.map(asset => Metadata.fromJson(asset));
  } catch (_) {
    return [];
  }
};

export const setRecentAssets = (assets: Metadata[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    RECENT_STORE_LS_KEY,
    JSON.stringify(assets.map(asset => asset.toJson())),
  );
};

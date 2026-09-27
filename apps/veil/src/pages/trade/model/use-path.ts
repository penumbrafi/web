import { useAssets } from '@/shared/api/assets';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

interface PathParams {
  baseSymbol: string;
  quoteSymbol: string;
  [key: string]: string; // required for useParams signature
}

interface PathQueryParams {
  highlight?: 'liquidity';
}

export const usePathSymbols = () => {
  const params = useParams<PathParams>();
  if (!params) {
    throw new Error('No symbol params in path');
  }
  return { baseSymbol: params.baseSymbol, quoteSymbol: params.quoteSymbol };
};

export interface PathAssetMetadata {
  baseSymbol: string;
  quoteSymbol: string;
  baseAsset: Metadata | undefined;
  quoteAsset: Metadata | undefined;
}

// Converts symbol to Metadata
export const usePathToMetadata = (): PathAssetMetadata => {
  const { data } = useAssets();
  const { baseSymbol, quoteSymbol } = usePathSymbols();

  return useMemo(() => {
    // Hoist the per-asset toLowerCase outside the find callbacks so
    // we don't re-lowercase the search key once for every entry — on
    // a registry with several hundred assets the old form ran
    // toLowerCase ~4×N times per memo recompute, this runs it 2 +
    // (worst-case) N times. Two passes also lets us short-circuit if
    // both assets land in the same scan, but the registry is small
    // enough that two .find() calls is fine.
    const baseLc = baseSymbol.toLowerCase();
    const quoteLc = quoteSymbol.toLowerCase();
    return {
      baseSymbol,
      quoteSymbol,
      baseAsset: data.find(m => m.symbol.toLowerCase() === baseLc),
      quoteAsset: data.find(a => a.symbol.toLowerCase() === quoteLc),
    };
  }, [data, baseSymbol, quoteSymbol]);
};

export const usePathQuery = (): PathQueryParams => {
  const searchParams = useSearchParams();
  const highlight = searchParams?.get('highlight') as PathQueryParams['highlight'];

  return {
    highlight,
  };
};

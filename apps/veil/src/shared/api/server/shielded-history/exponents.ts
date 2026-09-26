/**
 * Display exponents for assets shielded on penumbra-1 that the registry
 * doesn't list, known out of band. Without these they'd read as base units,
 * 10^18 too large.
 */
const UNREGISTERED_EXPONENTS: Record<string, number> = {
  // transfer/channel-1/adydx
  'QArMRIpyiMTawMktm5j53HfLNMrI8TIBQ2wqyCfgtQY=': 18,
  // transfer/channel-4/gamm/pool/1402
  '9q1esp3t+R/2MuOJHP42FsAwkFk5Ss5KSJ8qlzN1gws=': 18,
};

export const unregisteredExponent = (assetId: string): number =>
  UNREGISTERED_EXPONENTS[assetId] ?? 0;

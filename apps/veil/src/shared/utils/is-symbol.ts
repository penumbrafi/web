import { referencePriceFor } from '@/shared/const/reference-price';

const STABLECOIN_SYMBOLS = ['USDC', 'USDY', 'USDT'];

// important numeraire symbols
const NUMERAIRE_SYMBOLS = ['BTC', 'UM'];

/**
 * Check if a symbol is a stablecoin.
 * `symbol` is internally converted to uppercase, so is case-insensitive.
 *
 * @param symbol - The symbol to check.
 * @returns True if the symbol is a stablecoin, false otherwise.
 */
export function isStablecoinSymbol(symbol: string): boolean {
  if (STABLECOIN_SYMBOLS.includes(symbol.toUpperCase())) {
    return true;
  }
  // Bridged variants (USDC.inj, USDT.inj, ...) are pegged in the reference
  // price table; without this the positions table quoted UM pairs as
  // USDC.inj/UM, the wrong way round.
  const src = referencePriceFor(symbol);
  return src?.kind === 'fixed' && src.usd === 1;
}

/**
 * Check if a symbol is an important numeraire like BTC or UM.
 * `symbol` is internally converted to uppercase, so is case-insensitive.
 *
 * @param symbol - The symbol to check.
 * @returns True if the symbol is an important numeraire, false otherwise.
 */
export function isNumeraireSymbol(symbol: string): boolean {
  return NUMERAIRE_SYMBOLS.includes(symbol.toUpperCase());
}

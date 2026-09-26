const amount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

export const formatAmount = (v: number): string => amount.format(v);
export const formatUsd = (v: number): string => usd.format(v);

const signed = (v: number, f: (x: number) => string): string => {
  if (v > 0) {
    return `+${f(v)}`;
  }
  return v < 0 ? `−${f(-v)}` : f(0);
};
export const formatSigned = (v: number): string => signed(v, formatAmount);
export const formatSignedUsd = (v: number): string => signed(v, formatUsd);

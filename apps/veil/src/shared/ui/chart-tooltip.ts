/**
 * What recharts hands a custom <Tooltip content>. Typed honestly instead of
 * `any`: `value` may be a number, a string or an array depending on the series,
 * and `label` is whatever the x-axis dataKey holds - so formatters coerce
 * before calling number methods (a string value used to crash `.toFixed`).
 */
export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly {
    name?: string | number;
    value?: number | string | readonly (number | string)[];
    color?: string;
  }[];
}

/** a tooltip value as a finite number (0 when it isn't one) */
export const tooltipNumber = (value: unknown): number => {
  const n = Number(Array.isArray(value) ? (value as unknown[])[0] : value);
  return Number.isFinite(n) ? n : 0;
};

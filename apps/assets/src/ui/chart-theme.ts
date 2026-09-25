/**
 * Chart colours. Categorical slots are the dataviz reference palette's dark
 * steps, in its fixed order; the eight validated together against the chart
 * surface (#171717): lightness band, chroma floor, adjacent-pair CVD
 * separation (worst 8.4), normal-vision floor (worst 19.3) and >= 3:1
 * contrast all pass. Assign by entity, in order; never a ninth generated hue.
 */
export const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

export const CHART = {
  surface: '#171717',
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  ink: '#fafafa',
  inkSecondary: '#c3c2b7',
  /** Tooltip crosshair. */
  cursor: '#898781',
} as const;

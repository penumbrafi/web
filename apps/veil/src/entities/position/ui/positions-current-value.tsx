import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { pnum } from '@penumbra-zone/types/pnum';
import { DisplayPosition } from '../model/types';
import { Dash } from './dash';

export const PositionsCurrentValue = ({
  order,
  marketPrice,
}: {
  order: DisplayPosition['orders'][number];
  /** Quote-per-order-base mid for this row, resolved by the parent table
   *  (route mid on /trade, the row's own pair book on /portfolio). The
   *  previous form called useMarketPrice() per row — on a 50-row positions
   *  table that mounted 50 hook stacks and 50 useBook subscriptions every
   *  render, even though React Query deduped the network call. */
  marketPrice: number | undefined;
}) => {
  const { baseAsset, quoteAsset } = order;

  // A Buy position's current value is simply its held quote reserves — no
  // mid required, so don't gate it behind the book.
  if (order.direction === 'Buy') {
    return (
      <ValueViewComponent
        valueView={pnum(quoteAsset.amount.toNumber(), quoteAsset.exponent).toValueView(
          quoteAsset.asset,
        )}
      />
    );
  }

  // No book for this pair (or not loaded yet): a static dash, never a
  // skeleton that would hang forever on a pair with no market.
  if (!marketPrice) {
    return <Dash />;
  }

  const computedValue = baseAsset.amount.toNumber() * marketPrice;
  if (!Number.isFinite(computedValue)) {
    return <Dash />;
  }

  return (
    <ValueViewComponent
      valueView={pnum(computedValue, quoteAsset.exponent).toValueView(quoteAsset.asset)}
    />
  );
};

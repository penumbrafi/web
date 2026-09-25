import { Text } from '@penumbra-zone/ui/Text';
import type { Trace } from '@/shared/api/server/book/types';
import { calculateSpread } from '../../model/trace';
import { usePathSymbols } from '../../model/use-path';
import { TICK_ARROW, TICK_TEXT_COLOR, useTickDirection } from '../../model/use-tick-direction';
import { pnum } from '@penumbra-zone/types/pnum';
import { tradeFormStore } from '../order-form/store/OrderFormStore';

export const SpreadRow = ({
  sellOrders,
  buyOrders,
}: {
  sellOrders: Trace[];
  buyOrders: Trace[];
}) => {
  const spreadInfo = calculateSpread(sellOrders, buyOrders);
  const pair = usePathSymbols();
  // Tick direction off the parsed mid-price string. The chart label, the
  // summary 'Mid price' card and the document title ticker already use
  // useTickDirection so the same number flashes the same colour
  // everywhere — surface the same idiom here.
  const direction = useTickDirection(spreadInfo ? parseFloat(spreadInfo.midPrice) : undefined);

  if (!spreadInfo) {
    return null;
  }

  const setMidPrice = () => {
    tradeFormStore.setWhichForm('Limit');
    tradeFormStore.limitForm.setPriceInput(spreadInfo.midPrice);
  };

  const midColor = TICK_TEXT_COLOR[direction];
  const arrow = TICK_ARROW[direction];

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={setMidPrice}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setMidPrice();
        }
      }}
      title='Click to set limit price to mid'
      className='col-span-4 flex h-full cursor-pointer items-center justify-center gap-2 border-b border-b-other-tonal-stroke px-3 py-3 text-xs hover:bg-action-hover-overlay'
    >
      <Text detailTechnical color={midColor}>
        {arrow}
        {pnum(spreadInfo.midPrice).toFormattedString({
          commas: false,
          decimals: 7,
        })}
      </Text>
      <Text detailTechnical color='text.secondary'>
        Spread:
      </Text>
      <Text detailTechnical color='text.primary'>
        {pnum(spreadInfo.amount).toFormattedString({
          commas: false,
          decimals: 6,
        })}{' '}
        {pair.quoteSymbol}
      </Text>
      <Text detailTechnical color='text.secondary'>
        ({parseFloat(spreadInfo.percentage).toFixed(2)}%)
      </Text>
    </div>
  );
};

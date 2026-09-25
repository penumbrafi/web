'use client';

import { FC, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import {
  Metadata,
  ValueView,
  Value,
  ValueView_KnownAssetId,
} from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Amount } from '@penumbra-zone/protobuf/penumbra/core/num/v1/num_pb';
import { PositionState_PositionStateEnum } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { connectionStore } from '@/shared/model/connection';
import { useGetMetadata } from '@/shared/api/assets';
import { AssetTotal, usePositionsSummary } from '../api/use-positions-summary';

const toValueView = (total: AssetTotal, metadata: Metadata | undefined): ValueView => {
  const lo = total.amount & ((1n << 64n) - 1n);
  const hi = total.amount >> 64n;
  const value = new Value({
    amount: new Amount({ lo, hi }),
    assetId: total.assetId,
  });
  if (metadata) {
    return new ValueView({
      valueView: {
        case: 'knownAssetId',
        value: new ValueView_KnownAssetId({ amount: value.amount, metadata }),
      },
    });
  }
  return new ValueView({
    valueView: { case: 'unknownAssetId', value: { amount: value.amount, assetId: total.assetId } },
  });
};

interface CardProps {
  title: string;
  hint?: string;
  states: PositionState_PositionStateEnum[];
}

const AssetTotalsCard: FC<CardProps> = ({ title, hint, states }) => {
  const getMetadata = useGetMetadata();
  const { data, isLoading } = usePositionsSummary(0, states);

  const items = useMemo(() => {
    if (!data) {return [];}
    return data.map(t => ({
      total: t,
      metadata: getMetadata(t.assetId),
    }));
  }, [data, getMetadata]);

  return (
    <div className='flex flex-1 flex-col gap-2 rounded-lg bg-other-tonal-fill5 p-4'>
      <div className='flex items-baseline gap-2'>
        <Text color='text.secondary'>{title}</Text>
        {hint && (
          <Text detail color='text.secondary'>
            {hint}
          </Text>
        )}
      </div>
      {isLoading && (
        <div className='h-6 w-32'>
          <Skeleton />
        </div>
      )}
      {!isLoading && items.length === 0 && (
        <Text color='text.secondary'>—</Text>
      )}
      {!isLoading && items.length > 0 && (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
          {items.map(({ total, metadata }, i) => (
            <ValueViewComponent
              key={i}
              valueView={toValueView(total, metadata)}
              context='table'
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const PositionsSummary = observer(() => {
  if (!connectionStore.connected) {return null;}
  return (
    <div className='flex flex-col gap-4 md:flex-row'>
      <AssetTotalsCard
        title='Open positions capital'
        hint='reserves in currently open orders'
        states={[PositionState_PositionStateEnum.OPENED]}
      />
      <AssetTotalsCard
        title='Closed positions capital'
        hint='reserves pending withdrawal'
        states={[PositionState_PositionStateEnum.CLOSED]}
      />
    </div>
  );
});

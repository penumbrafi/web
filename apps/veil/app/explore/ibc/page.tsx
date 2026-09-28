import { FC } from 'react';
import {
  Breadcrumb,
  Breadcrumbs,
  Container,
  FilterSelector,
  TimeRangeSelector,
} from '@/pages/inspect/explorer/components';
import { IbcFlowHistoryContainer, IbcTableContainer } from '@/pages/inspect/explorer/containers';
import { CLIENT_FILTERS, isClientFilter } from '@/pages/inspect/explorer/lib/ibc/client-health';
import { nonEmpty } from '@/pages/inspect/explorer/lib/utils';
export const dynamic = 'force-dynamic';

/** ?range= values the flow chart accepts; anything else is 30 days. */
const RANGE_DAYS = new Map([
  ['7', 7],
  ['90', 90],
  ['365', 365],
]);

interface Props {
  searchParams: Promise<{ filter?: string; range?: string }>;
}

const IbcPage: FC<Props> = async props => {
  const searchParams = await props.searchParams;
  // Expired and frozen clients outnumber the live ones by an order of
  // magnitude, so dead channels are opt-in tabs and `open` is the default.
  const filter = isClientFilter(searchParams.filter) ? searchParams.filter : 'open';

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>IBC Chains</Breadcrumb>
      </Breadcrumbs>
      <IbcFlowHistoryContainer
        days={RANGE_DAYS.get(searchParams.range ?? '') ?? 30}
        timeRangeSelector={
          <TimeRangeSelector
            paramName='range'
            ranges={[
              { label: '30d', value: '30' },
              { label: '7d', value: '7' },
              { label: '90d', value: '90' },
              { label: '1y', value: '365' },
            ]}
            selectedRange={nonEmpty(searchParams.range) ?? '30'}
          />
        }
      />
      <IbcTableContainer
        className='mt-4'
        filter={filter}
        header={
          <header className='flex flex-wrap items-center justify-between gap-4'>
            <h2 className='text-xl font-medium sm:text-2xl'>IBC clients</h2>
            <FilterSelector filters={[...CLIENT_FILTERS]} selectedFilter={filter} />
          </header>
        }
      />
    </Container>
  );
};

export default IbcPage;

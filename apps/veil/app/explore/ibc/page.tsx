import { FC } from 'react';
import {
  Breadcrumb,
  Breadcrumbs,
  Container,
  TimeRangeSelector,
} from '@/pages/inspect/explorer/components';
import { IbcFlowHistoryContainer, IbcTableContainer } from '@/pages/inspect/explorer/containers';
import { nonEmpty } from '@/pages/inspect/explorer/lib/utils';
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ range?: string }>;
}

const IbcPage: FC<Props> = async props => {
  const searchParams = await props.searchParams;

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>IBC Chains</Breadcrumb>
      </Breadcrumbs>
      <IbcFlowHistoryContainer
        days={
          searchParams.range === '7'
            ? 7
            : searchParams.range === '90'
              ? 90
              : searchParams.range === '365'
                ? 365
                : 30
        }
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
      <IbcTableContainer className='mt-4' />
    </Container>
  );
};

export default IbcPage;

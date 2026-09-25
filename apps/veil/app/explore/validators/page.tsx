import { FC, Suspense } from 'react';
import {
  Breadcrumb,
  Breadcrumbs,
  Button,
  Container,
  FilterSelector,
  Skeleton,
  ValidatorSortToggle,
} from '@/pages/inspect/explorer/components';
import {
  ActiveValidatorsPanelContainer,
  ActiveVotingPowerPanelContainer,
  ChainParametersContainer,
  MinValidatorStakePanelContainer,
  ValidatorParametersContainer,
  ValidatorTableContainer,
} from '@/pages/inspect/explorer/containers';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import { ValidatorStateFilter } from '@/pages/inspect/explorer/lib/graphql/generated/types';
import { ProgressiveActiveStakeChart } from '@/pages/inspect/explorer/ui/active-stake-chart';
import { fetchActiveStakeHistory } from '@/pages/inspect/explorer/server/active-stake-history';
import {
  parseStakeRange,
  stakeRangeDays,
  stakeStepFor,
  type StakeRangeKey,
} from '@/pages/inspect/explorer/ui/stake-range';
export const dynamic = 'force-dynamic';

/** ?sort= values the validator table understands; anything else is ignored. */
const SORT_KEYS = ['commission', 'growth30d', 'growth7d', 'name', 'power', 'uptime'] as const;

// Progressive-refinement chart loader. Awaits the cheap coarse-step query
// (always returns within ~150ms even for 2y) and kicks the denser query as
// a pending Promise. ProgressiveActiveStakeChart renders coarse immediately
// and replaces the data with dense when its Promise resolves via React.use().
// Net effect: chart is visible within a few hundred ms regardless of window;
// resolution sharpens up shortly after.
async function StakeChartSection({ range }: { range: StakeRangeKey }) {
  const days = stakeRangeDays(range);
  const { coarse, dense } = stakeStepFor(days);
  const coarseData = await fetchActiveStakeHistory(days, coarse);
  // NOT awaited — gets passed across the RSC boundary as a pending Promise.
  // A failed refinement keeps the coarse series rather than throwing
  // through use() on the client and taking the whole page down.
  const densePromise = fetchActiveStakeHistory(days, dense).catch(() => coarseData);
  return (
    <ProgressiveActiveStakeChart
      coarseData={coarseData}
      densePromise={densePromise}
      currentRange={range}
    />
  );
}

const StakeChartSkeleton = () => (
  <section className='flex flex-col gap-6'>
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-7 w-56' />
      <Skeleton className='h-4 w-full max-w-2xl' />
    </div>
    <div className='grid grid-cols-2 gap-3 desktop:grid-cols-4'>
      <Skeleton className='h-24' />
      <Skeleton className='h-24' />
      <Skeleton className='h-24' />
      <Skeleton className='h-24' />
    </div>
    <Skeleton className='h-[332px]' />
  </section>
);

interface Props {
  searchParams: Promise<{
    all?: string;
    dir?: string;
    filter?: string;
    sort?: string;
    range?: string;
  }>;
}

const ValidatorsPage: FC<Props> = async props => {
  const searchParams = await props.searchParams;
  // Cap SSR rendering at 50 rows by default — well past top-of-fold,
  // and the active validator set is ~250 rows. Unbounded rendering
  // inflates the response by ~4x for content nobody reads before
  // scrolling. `?all=1` opts back into the full list.
  const validatorLimit = searchParams.all === '1' ? undefined : 50;
  const stateFilter =
    searchParams.filter === 'inactive'
      ? ValidatorStateFilter.Inactive
      : ValidatorStateFilter.Active;

  const stakeRange = parseStakeRange(searchParams.range);

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb>Validators</Breadcrumb>
      </Breadcrumbs>

      {/* Streaming boundary: the rest of the page paints right away;
          the chart fills in when its (cached) fetch resolves. Keyed by
          stakeRange so switching ranges shows the skeleton again
          instead of stale data. */}
      <Suspense key={stakeRange} fallback={<StakeChartSkeleton />}>
        <StakeChartSection range={stakeRange} />
      </Suspense>
      <div className='grid grid-cols-12 gap-4 lg:items-start'>
        <ActiveVotingPowerPanelContainer
          className='col-span-full md:col-span-4'
          state={stateFilter}
        />
        <ActiveValidatorsPanelContainer
          className={classNames('col-span-full sm:col-span-6 md:col-span-4')}
        />
        <MinValidatorStakePanelContainer
          className={classNames('col-span-full sm:col-span-6 md:col-span-4')}
        />
        <ChainParametersContainer
          className={classNames(
            'col-span-full md:col-span-6 lg:col-span-3!',
            'lg:col-start-10! lg:row-start-2!',
          )}
        />
        <ValidatorParametersContainer
          className={classNames(
            'col-span-full md:col-span-6 lg:col-span-3!',
            'lg:col-start-10! lg:row-start-3!',
          )}
        />
        <ValidatorTableContainer
          className={classNames(
            'col-span-full lg:col-span-9 lg:col-start-1',
            'lg:row-span-3 lg:row-start-2',
          )}
          header={
            <div className='flex flex-col gap-6'>
              <div
                className={classNames(
                  'flex flex-col gap-2 md:flex-row',
                  'md:items-center md:justify-between',
                )}
              >
                <h1 className='text-2xl font-medium'>Validator performance</h1>
                <div className='flex flex-wrap gap-2'>
                  <Button density='compact' href='/portfolio/staking'>
                    Delegate to a validator
                  </Button>
                  <Button
                    density='compact'
                    href='https://guide.penumbra.zone/node/pd/validator'
                    priority='secondary'
                  >
                    Become a validator
                  </Button>
                </div>
              </div>
              <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
                <FilterSelector
                  filters={['active', 'inactive']}
                  selectedFilter={searchParams.filter}
                />
                <ValidatorSortToggle />
              </div>
            </div>
          }
          inactive={searchParams.filter === 'inactive'}
          limit={validatorLimit}
          sort={SORT_KEYS.find(k => k === searchParams.sort)}
          sortDir={searchParams.dir === 'asc' || searchParams.dir === 'desc' ? searchParams.dir : undefined}
        />
      </div>
    </Container>
  );
};

export default ValidatorsPage;

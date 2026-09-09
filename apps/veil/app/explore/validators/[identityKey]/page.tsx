export const dynamic = 'force-dynamic';
import { FC } from 'react';
import { Breadcrumb, Breadcrumbs, Container } from '@/pages/inspect/explorer/components';
import {
  TransactionTableContainer,
  ValidatorActiveSincePanelContainer,
  ValidatorContainer,
  ValidatorDelegationFlowContainer,
  ValidatorStatusContainer,
  ValidatorVotingPercentagePanelContainer,
  ValidatorVotingPowerHistoryContainer,
  ValidatorVotingPowerPanelContainer,
} from '@/pages/inspect/explorer/containers';
import { fetchValidatorStakeHistory } from '@/pages/inspect/explorer/server/validator-stake-history';
import { fetchValidatorSlashings } from '@/pages/inspect/explorer/server/validator-slashings';
import { ValidatorStakeHistoryChart } from '@/pages/inspect/explorer/ui/validator-stake-history-chart';
import { ValidatorSlashingsPanel } from '@/pages/inspect/explorer/ui/validator-slashings-panel';
import { ValidatorStakeActions } from '@/pages/inspect/explorer/ui/validator-stake-actions';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import { StakingDialogHostClient } from './staking-dialog-host-client';

interface Props {
  params: Promise<{ identityKey: string }>;
}

const ValidatorDetailPage: FC<Props> = async props => {
  const { identityKey: rawIdentityKey } = await props.params;
  const identityKey = decodeURIComponent(rawIdentityKey);

  const [stakeHistory, slashings] = await Promise.all([
    fetchValidatorStakeHistory(identityKey, 90),
    fetchValidatorSlashings(identityKey, 50),
  ]);

  return (
    <Container>
      <Breadcrumbs>
        <Breadcrumb href='/explore'>Explore</Breadcrumb>
        <Breadcrumb href='/explore/validators'>Validators</Breadcrumb>
      </Breadcrumbs>

      <div className='grid grid-cols-12 items-start gap-4'>
        <ValidatorContainer
          className={classNames(
            'col-span-12 md:col-span-5 md:row-span-4',
            'lg:col-span-4! lg:row-span-3',
          )}
          validatorId={identityKey}
        />
        <ValidatorVotingPowerPanelContainer
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'md:row-start-1 lg:col-span-3! lg:col-start-5!',
          )}
          validatorId={identityKey}
        />
        <ValidatorVotingPercentagePanelContainer
          className={classNames(
            'col-span-12 md:col-span-3 md:col-start-6',
            'md:row-start-2 lg:col-span-2! lg:col-start-8!',
            'lg:row-start-1!',
          )}
          validatorId={identityKey}
        />
        <ValidatorActiveSincePanelContainer
          className={classNames(
            'col-span-12 md:col-span-4 md:col-start-9',
            'md:row-start-2 lg:col-span-3! lg:col-start-10!',
            'lg:row-start-1!',
          )}
          validatorId={identityKey}
        />
        <ValidatorStakeActions
          validatorId={identityKey}
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
        />
        <div
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
            'rounded-lg bg-other-base p-6',
          )}
        >
          <ValidatorStakeHistoryChart data={stakeHistory} />
        </div>
        <ValidatorStatusContainer
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
          validatorId={identityKey}
        />
        <ValidatorVotingPowerHistoryContainer
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
          validatorId={identityKey}
        />
        <ValidatorDelegationFlowContainer
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
          validatorId={identityKey}
        />
        <ValidatorSlashingsPanel
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
          slashings={slashings}
        />
        <TransactionTableContainer
          className={classNames(
            'col-span-12 md:col-span-7 md:col-start-6',
            'lg:col-span-8! lg:col-start-5!',
          )}
          filter={{ validator: identityKey }}
          header={<h2 className='text-2xl font-medium'>Latest transactions</h2>}
          limit={{ length: 10 }}
          blockHeight
          time
        />
      </div>
      <StakingDialogHostClient />
    </Container>
  );
};

export default ValidatorDetailPage;

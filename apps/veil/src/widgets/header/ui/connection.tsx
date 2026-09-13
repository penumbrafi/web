import { observer } from 'mobx-react-lite';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { connectionStore } from '@/shared/model/connection';
import { ConnectButton } from '@/features/connect/connect-button';
import { DepositButton } from '@/features/deposit/deposit-button';
import { SubaccountSelector } from '@/widgets/header/ui/subaccount-selector';

export interface ConnectionProps {
  mobile?: boolean;
}

export const Connection = observer(({ mobile }: ConnectionProps) => {
  if (connectionStore.connectedLoading) {
    return mobile ? null : (
      <div className='h-12 w-28'>
        <Skeleton />
      </div>
    );
  }

  if (!connectionStore.connected) {
    return <ConnectButton variant={mobile ? 'mobile' : 'default'} />;
  }

  if (mobile) {
    // Deposit button now lives inside the mobile menu drawer to keep the
    // top bar to just the wallet chip + hamburger.
    return (
      <div className='max-w-32'>
        <SubaccountSelector mobile />
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2'>
      <DepositButton variant='minimal' />
      <SubaccountSelector />
    </div>
  );
});

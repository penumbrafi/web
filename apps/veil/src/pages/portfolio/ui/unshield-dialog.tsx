import { Button } from '@penumbra-zone/ui/Button';
import { ShieldedBalance } from '@/pages/portfolio/api/use-unified-assets.ts';
import { useEffect, useState } from 'react';
import { Text } from '@penumbra-zone/ui/Text';
import { getDisplayDenomExponentFromValueView, getMetadata } from '@penumbra-zone/getters/value-view';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { WalletBalance } from '@penumbra-zone/ui/WalletBalance';
import { AssetSelector } from '@penumbra-zone/ui/AssetSelector';
import { Density } from '@penumbra-zone/ui/Density';
import { pnum } from '@penumbra-zone/types/pnum';
import { ShieldOff } from 'lucide-react';
import { useRegistry } from '@/shared/api/registry.tsx';
import Image from 'next/image';
import { Dialog } from '@penumbra-zone/ui/Dialog';

import {
  amountMoreThanBalance,
  sendIbcOut,
  unknownAddrIsValid,
} from '@/pages/portfolio/withdraw/lib/ics20-withdraw';

// Re-export the helpers so existing callers importing from this module
// keep working. New callers should prefer the lib module directly.
export {
  amountMoreThanBalance,
  currentTimePlusTwoDaysRounded,
  BLOCKS_PER_HOUR,
  BLOCKS_PER_MINUTE,
  sendIbcOut,
  unknownAddrIsValid,
} from '@/pages/portfolio/withdraw/lib/ics20-withdraw';

export function UnshieldDialog({ asset }: { asset: ShieldedBalance }) {
  const [amount, setAmount] = useState(pnum(asset.valueView).toString());
  const [destAddress, setDestAddress] = useState('');
  const metadata = getMetadata(asset.valueView);
  const { data: registry } = useRegistry();
  const channelId = metadata.base.split('/')[1] ?? '';
  const destinationChain = registry.ibcConnections.find(chain => chain.channelId === channelId);

  const [isAddressValid, setIsAddressValid] = useState(true);
  useEffect(() => {
    if (destAddress !== '') {
      setIsAddressValid(unknownAddrIsValid(destinationChain, destAddress));
    }
  }, [destAddress, destinationChain]);

  const [isAmountValid, setIsAmountValid] = useState(true);
  useEffect(() => {
    setIsAmountValid(!amountMoreThanBalance(asset.balance, amount));
  }, [amount, asset.balance]);

  const [isIbcInProgress, setIsIbcInProgress] = useState(false);

  return (
    <Dialog>
      <Dialog.Trigger asChild>
        <Button actionType='unshield' density='slim' priority='secondary'>
          Unshield
        </Button>
      </Dialog.Trigger>

      <Dialog.Content title='Unshield'>
        <div className='relative overflow-hidden rounded-xl p-6 backdrop-blur-lg'>
          <Image
            priority
            src='/assets/unshield-backdrop.svg'
            alt='Unshield backdrop'
            fill
            className='pointer-events-none -z-10 object-cover opacity-30'
          />
          <form
            className='flex flex-col gap-4'
            onSubmit={e => {
              e.preventDefault();
            }}
          >
            <Text variant={'body'} color={'text.primary'}>
              Destination Chain
            </Text>
            <TextInput
              startAdornment={
                <Image
                  width={24}
                  height={24}
                  src={destinationChain?.images[0]?.png ?? ''}
                  alt={destinationChain?.displayName ?? ''}
                />
              }
              value={destinationChain?.displayName ?? ''}
            />
            <Text variant={'detail'} color={'text.secondary'}>
              Unshielding can only be done to the asset&apos;s source chain.
            </Text>

            <Text variant={'body'} color={'text.primary'}>
              Amount
            </Text>
            <TextInput
              endAdornment={
                <Density compact>
                  <AssetSelector assets={[metadata]} actionType={'default'} value={metadata} />
                </Density>
              }
              onChange={value => setAmount(value)}
              value={amount}
            />
            {!isAmountValid && (
              <Text variant={'detail'} color={'destructive.main'}>
                Amount is greater than balance
              </Text>
            )}
            <div
              className={'w-fit cursor-pointer'}
              onClick={() => setAmount(pnum(asset.balance.balanceView).toString())}
            >
              <WalletBalance balance={asset.balance} />
            </div>
            <Text variant={'body'} color={'text.primary'}>
              Destination Address
            </Text>
            <TextInput
              actionType={isAddressValid ? 'default' : 'destructive'}
              onChange={val => setDestAddress(val)}
            />
            {!isAddressValid && destAddress !== '' && (
              <Text variant={'detail'} color={'destructive.main'}>
                This address is not valid on the destination chain
              </Text>
            )}

            <Button
              type='submit'
              actionType={'unshield'}
              priority={'primary'}
              density={'sparse'}
              icon={ShieldOff}
              disabled={!isAddressValid || !isAmountValid || isIbcInProgress}
              onClick={() => {
                void (async () => {
                  if (destAddress === '') {
                    return;
                  }
                  setIsIbcInProgress(true);
                  try {
                    await sendIbcOut(
                      asset,
                      pnum(
                        amount,
                        getDisplayDenomExponentFromValueView(asset.valueView),
                      ).toString(),
                      destAddress,
                    );
                  } finally {
                    setIsIbcInProgress(false);
                  }
                })();
              }}
            >
              Unshield
            </Button>
          </form>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Send } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { AssetSelector, isBalancesResponse } from '@penumbra-zone/ui/AssetSelector';
import { WalletBalance } from '@penumbra-zone/ui/WalletBalance';
import { Density } from '@penumbra-zone/ui/Density';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { BalancesResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { Address, AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { isAddress, addressFromBech32m } from '@penumbra-zone/bech32m/penumbra';
import { getMetadataFromBalancesResponse } from '@penumbra-zone/getters/balances-response';
import { getMetadata } from '@penumbra-zone/getters/value-view';
import { assetPatterns } from '@penumbra-zone/types/assets';
import { pnum } from '@penumbra-zone/types/pnum';
import { useBalances } from '@/shared/api/balances';
import { connectionStore } from '@/shared/model/connection';
import { balanceMatchesSubaccount, sendShielded, sendValidationErrors } from '../api/send-shielded';

const NON_TRANSFERABLE = [
  assetPatterns.lpNft,
  assetPatterns.auctionNft,
  assetPatterns.proposalNft,
  assetPatterns.unbondingToken,
  assetPatterns.delegationToken,
  assetPatterns.votingReceipt,
];

const isTransferable = (balance: BalancesResponse): boolean => {
  const metadata = getMetadataFromBalancesResponse.optional(balance);
  if (!metadata) {
    return false;
  }
  return NON_TRANSFERABLE.every(pattern => !pattern.matches(metadata.display));
};

interface SendPanelProps {
  /** Asset to start on, e.g. the token row the modal was opened from. */
  initialBalance?: BalancesResponse;
  /** Called after a send is submitted, so a modal host can close. */
  onSent?: () => void;
}

export const SendPanel = observer(({ initialBalance, onSent }: SendPanelProps) => {
  const { subaccount } = connectionStore;
  const { data: balances, isLoading } = useBalances(subaccount);

  const transferable = useMemo(
    () => balances?.filter(b => balanceMatchesSubaccount(b, subaccount) && isTransferable(b)) ?? [],
    [balances, subaccount],
  );

  const [selection, setSelection] = useState<BalancesResponse | undefined>(initialBalance);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Subaccount changes invalidate the existing selection because balances are scoped per account.
  // Skip the mount run so an `initialBalance` survives.
  const lastSubaccount = useRef(subaccount);
  useEffect(() => {
    if (lastSubaccount.current !== subaccount) {
      lastSubaccount.current = subaccount;
      setSelection(undefined);
    }
  }, [subaccount]);

  useEffect(() => {
    if (!selection && transferable.length > 0) {
      setSelection(transferable[0]);
    }
  }, [selection, transferable]);

  const recipientValid = recipient === '' || isAddress(recipient);
  const validation = sendValidationErrors({ selection, amount, memo });

  const canSubmit =
    !submitting &&
    !!selection &&
    !!amount &&
    Number(amount) > 0 &&
    !!recipient &&
    recipientValid &&
    !validation.amountErr &&
    !validation.exponentErr &&
    !validation.memoErr;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await sendShielded({
        selection,
        amount,
        recipient: new Address(addressFromBech32m(recipient)),
        memo,
        source: new AddressIndex({ account: subaccount }),
      });
      setAmount('');
      setMemo('');
      // planBuildBroadcast resolves undefined on failure; keep the form open then.
      if (result) {
        onSent?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className='flex h-[120px] w-full'>
        <Skeleton />
      </div>
    );
  }

  if (transferable.length === 0) {
    return (
      <div className='flex flex-col items-center gap-2 py-6'>
        <Text color='text.secondary' align='center'>
          No transferable shielded balances in{' '}
          {subaccount === 0 ? 'your main account' : `sub-account ${subaccount}`}.
        </Text>
      </div>
    );
  }

  return (
    <form className='flex flex-col gap-4' onSubmit={e => void onSubmit(e)}>
      <div className='flex flex-col gap-2'>
        <Text body color='text.primary'>
          Recipient
        </Text>
        <TextInput
          actionType={recipientValid ? 'default' : 'destructive'}
          placeholder='penumbra1…'
          value={recipient}
          onChange={setRecipient}
        />
        {!recipientValid && (
          <Text detail color='destructive.light'>
            Invalid Penumbra address
          </Text>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Text body color='text.primary'>
          Amount
        </Text>
        <TextInput
          actionType={validation.amountErr || validation.exponentErr ? 'destructive' : 'default'}
          placeholder='0'
          value={amount}
          onChange={value => {
            if (Number(value) < 0) {
              return;
            }
            setAmount(value);
          }}
          endAdornment={
            <Density compact>
              <AssetSelector
                balances={transferable}
                value={selection}
                onChange={value => {
                  if (isBalancesResponse(value)) {
                    setSelection(value);
                  }
                }}
              />
            </Density>
          }
        />
        {validation.amountErr && (
          <Text detail color='destructive.light'>
            Amount exceeds balance
          </Text>
        )}
        {validation.exponentErr && (
          <Text detail color='destructive.light'>
            Too many decimal places for{' '}
            {selection ? getMetadata.optional(selection.balanceView)?.symbol : 'asset'}
          </Text>
        )}
        {selection && (
          <div
            className='w-fit cursor-pointer'
            onClick={() => setAmount(pnum(selection.balanceView).toString())}
          >
            <WalletBalance balance={selection} />
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Text body color='text.primary'>
          Memo
        </Text>
        <TextInput
          actionType={validation.memoErr ? 'destructive' : 'default'}
          placeholder='Optional message'
          value={memo}
          onChange={setMemo}
        />
        {validation.memoErr && (
          <Text detail color='destructive.light'>
            Memo too long (max 432 bytes)
          </Text>
        )}
      </div>

      <Button
        type='submit'
        actionType='accent'
        priority='primary'
        density='sparse'
        icon={Send}
        disabled={!canSubmit}
      >
        {submitting ? 'Sending…' : 'Send'}
      </Button>
    </form>
  );
});

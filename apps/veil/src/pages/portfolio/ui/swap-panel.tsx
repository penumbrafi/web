'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowLeftRight } from 'lucide-react';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { TextInput } from '@penumbra-zone/ui/TextInput';
import { AssetSelector, isBalancesResponse, isMetadata } from '@penumbra-zone/ui/AssetSelector';
import { WalletBalance } from '@penumbra-zone/ui/WalletBalance';
import { Density } from '@penumbra-zone/ui/Density';
import { Skeleton } from '@penumbra-zone/ui/Skeleton';
import { BalancesResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { AddressIndex } from '@penumbra-zone/protobuf/penumbra/core/keys/v1/keys_pb';
import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getMetadataFromBalancesResponse } from '@penumbra-zone/getters/balances-response';
import { getMetadata } from '@penumbra-zone/getters/value-view';
import { assetPatterns } from '@penumbra-zone/types/assets';
import { pnum } from '@penumbra-zone/types/pnum';
import { useBalances } from '@/shared/api/balances';
import { useRegistryAssets } from '@/shared/api/registry';
import { connectionStore } from '@/shared/model/connection';
import { ConfirmOrderModal, ConfirmInfoRow } from '@/pages/trade/ui/order-form/confirm-order-modal';
import { balanceMatchesSubaccount } from '../api/send-shielded';
import { swapShielded, swapValidationErrors } from '../api/swap-shielded';

const NON_SWAPPABLE = [
  assetPatterns.lpNft,
  assetPatterns.auctionNft,
  assetPatterns.proposalNft,
  assetPatterns.unbondingToken,
  assetPatterns.delegationToken,
  assetPatterns.votingReceipt,
];

const isSwappable = (balance: BalancesResponse): boolean => {
  const metadata = getMetadataFromBalancesResponse.optional(balance);
  if (!metadata) {
    return false;
  }
  return NON_SWAPPABLE.every(pattern => !pattern.matches(metadata.display));
};

interface SwapPanelProps {
  /** Asset to swap from, e.g. the token row the modal was opened from. */
  initialBalance?: BalancesResponse;
  /** Called after a swap is submitted, so a modal host can close. */
  onSwapped?: () => void;
}

export const SwapPanel = observer(({ initialBalance, onSwapped }: SwapPanelProps) => {
  const { subaccount } = connectionStore;
  const { data: balances, isLoading } = useBalances(subaccount);
  const { data: registryAssets } = useRegistryAssets();

  const swappable = useMemo(
    () => balances?.filter(b => balanceMatchesSubaccount(b, subaccount) && isSwappable(b)) ?? [],
    [balances, subaccount],
  );

  const [fromSelection, setFromSelection] = useState<BalancesResponse | undefined>(initialBalance);
  const [toAsset, setToAsset] = useState<Metadata | undefined>();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Skip the mount run so an `initialBalance` survives.
  const lastSubaccount = useRef(subaccount);
  useEffect(() => {
    if (lastSubaccount.current !== subaccount) {
      lastSubaccount.current = subaccount;
      setFromSelection(undefined);
      setToAsset(undefined);
      setAmount('');
    }
  }, [subaccount]);

  useEffect(() => {
    if (!fromSelection && swappable.length > 0) {
      setFromSelection(swappable[0]);
    }
  }, [fromSelection, swappable]);

  const fromMetadata = useMemo(
    () => getMetadataFromBalancesResponse.optional(fromSelection),
    [fromSelection],
  );

  const toAssetOptions = useMemo(() => {
    if (!fromMetadata?.penumbraAssetId) {
      return registryAssets;
    }
    return registryAssets.filter(m => !m.penumbraAssetId?.equals(fromMetadata.penumbraAssetId));
  }, [registryAssets, fromMetadata]);

  const validation = swapValidationErrors({
    selection: fromSelection,
    toAsset,
    amount,
  });

  const canSubmit =
    !submitting &&
    !!fromSelection &&
    !!toAsset &&
    !!amount &&
    Number(amount) > 0 &&
    !validation.amountErr &&
    !validation.exponentErr &&
    !validation.sameAssetErr;

  const fromSymbol = fromMetadata?.symbol ?? '';
  const toSymbol = toAsset?.symbol ?? '';

  const confirmRows = useMemo<ConfirmInfoRow[]>(() => {
    const rows: ConfirmInfoRow[] = [];
    if (amount && fromSymbol) {
      rows.push({ label: 'You pay', value: `${amount} ${fromSymbol}` });
    }
    if (toSymbol) {
      rows.push({
        label: 'You receive',
        value: `${toSymbol} (priced at execution)`,
      });
    }
    return rows;
  }, [amount, fromSymbol, toSymbol]);

  const onConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const result = await swapShielded({
        selection: fromSelection,
        amount,
        toAsset,
        source: new AddressIndex({ account: subaccount }),
      });
      setAmount('');
      // planBuildBroadcast resolves undefined on failure; keep the form open then.
      if (result) {
        onSwapped?.();
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

  if (swappable.length === 0) {
    return (
      <div className='flex flex-col items-center gap-2 py-6'>
        <Text color='text.secondary' align='center'>
          No swappable shielded balances in{' '}
          {subaccount === 0 ? 'your main account' : `sub-account ${subaccount}`}.
        </Text>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2'>
        <Text body color='text.primary'>
          From
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
                balances={swappable}
                value={fromSelection}
                onChange={value => {
                  if (isBalancesResponse(value)) {
                    setFromSelection(value);
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
            {fromSelection ? getMetadata.optional(fromSelection.balanceView)?.symbol : 'asset'}
          </Text>
        )}
        {fromSelection && (
          <div
            className='w-fit cursor-pointer'
            onClick={() => setAmount(pnum(fromSelection.balanceView).toString())}
          >
            <WalletBalance balance={fromSelection} />
          </div>
        )}
      </div>

      <div className='flex justify-center'>
        <ArrowDown className='size-4 text-text-secondary' />
      </div>

      <div className='flex flex-col gap-2'>
        <Text body color='text.primary'>
          To
        </Text>
        <div className='flex h-12 items-center justify-between rounded-sm border border-other-tonal-stroke px-3'>
          <Text small color='text.secondary'>
            Receive {toSymbol || 'an asset'}
          </Text>
          <Density compact>
            <AssetSelector
              assets={toAssetOptions}
              value={toAsset}
              dialogTitle='Swap to'
              onChange={value => {
                if (isMetadata(value)) {
                  setToAsset(value);
                }
              }}
            />
          </Density>
        </div>
        {validation.sameAssetErr && (
          <Text detail color='destructive.light'>
            Pick a different asset to swap into
          </Text>
        )}
      </div>

      <Button
        type='button'
        actionType='accent'
        priority='primary'
        density='sparse'
        icon={ArrowLeftRight}
        disabled={!canSubmit}
        onClick={() => setConfirmOpen(true)}
      >
        {submitting ? 'Swapping…' : 'Swap'}
      </Button>

      <ConfirmOrderModal
        isOpen={confirmOpen}
        actionLabel={
          fromSymbol && toSymbol && amount ? `Swap ${amount} ${fromSymbol} → ${toSymbol}` : 'Swap'
        }
        subLabel='Output is priced at the route book at execution time. A claim transaction will follow once the swap commits.'
        rows={confirmRows}
        confirmDisabled={!canSubmit}
        confirmLabel='Confirm swap'
        onConfirm={() => void onConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
});

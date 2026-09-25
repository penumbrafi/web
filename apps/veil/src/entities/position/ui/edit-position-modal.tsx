import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Position,
  PositionId,
} from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AssetId } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Button } from '@penumbra-zone/ui/Button';
import { Text } from '@penumbra-zone/ui/Text';
import { pnum } from '@penumbra-zone/types/pnum';
import { getDisplayDenomExponent } from '@penumbra-zone/getters/metadata';
import { bech32mPositionId } from '@penumbra-zone/bech32m/plpid';
import { useGetMetadata } from '@/shared/api/assets';
import { OrderInput } from '@/pages/trade/ui/order-form/order-input';
import { InfoRow } from '@/pages/trade/ui/order-form/info-row';
import { LiquidityDistributionShape, planToPosition } from '@/shared/math/position';
import { parseNumber } from '@/shared/utils/num';
import { editPosition } from '../api/edit-position';
import { inFlightPositions } from '../api/position-actions-lock';

interface EditPositionModalProps {
  id: PositionId;
  position: Position;
  isOpen: boolean;
  onClose: () => void;
}

interface Prefill {
  price: string;
  feePercent: string;
  baseAmount: string;
  quoteAmount: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseExponent: number;
  quoteExponent: number;
  baseAssetId: AssetId;
  quoteAssetId: AssetId;
}

// Uses the position's own asset1/asset2 ordering as base/quote — planToPosition
// re-canonicalises via compareAssetId, so the table's display orientation doesn't
// need to be threaded through.
const buildPrefill = (
  position: Position,
  getMetadata: ReturnType<typeof useGetMetadata>,
): Prefill | undefined => {
  const phi = position.phi;
  const reserves = position.reserves;
  if (!phi?.component || !phi.pair || !reserves) {
    return undefined;
  }
  const { p, q, fee } = phi.component;
  const asset1Id = phi.pair.asset1;
  const asset2Id = phi.pair.asset2;
  if (!p || !q || !asset1Id || !asset2Id) {
    return undefined;
  }
  const asset1Meta = getMetadata(asset1Id);
  const asset2Meta = getMetadata(asset2Id);
  if (!asset1Meta || !asset2Meta) {
    return undefined;
  }
  const exp1 = getDisplayDenomExponent.optional(asset1Meta);
  const exp2 = getDisplayDenomExponent.optional(asset2Meta);
  if (exp1 === undefined || exp2 === undefined) {
    return undefined;
  }

  const pNum = pnum(p).toNumber();
  const qNum = pnum(q).toNumber();
  if (qNum === 0) {
    return undefined;
  }
  // Inverse of priceToPQ in shared/math/position.ts.
  const displayPrice = (pNum / qNum) * Math.pow(10, exp1 - exp2);

  return {
    price: displayPrice.toString(),
    feePercent: (fee / 100).toString(),
    baseAmount: pnum(reserves.r1, exp1).toNumber().toString(),
    quoteAmount: pnum(reserves.r2, exp2).toNumber().toString(),
    baseSymbol: asset1Meta.symbol,
    quoteSymbol: asset2Meta.symbol,
    baseExponent: exp1,
    quoteExponent: exp2,
    baseAssetId: asset1Id,
    quoteAssetId: asset2Id,
  };
};

export const EditPositionModal = observer(
  ({ id, position, isOpen, onClose }: EditPositionModalProps) => {
    const getMetadata = useGetMetadata();
    const prefill = useMemo(() => buildPrefill(position, getMetadata), [position, getMetadata]);
    const busy = inFlightPositions.has(bech32mPositionId(id));

    const [price, setPrice] = useState(prefill?.price ?? '');
    const [feePercent, setFeePercent] = useState(prefill?.feePercent ?? '');
    const [baseAmount, setBaseAmount] = useState(prefill?.baseAmount ?? '');
    const [quoteAmount, setQuoteAmount] = useState(prefill?.quoteAmount ?? '');
    const [submitting, setSubmitting] = useState(false);

    if (!prefill) {
      return null;
    }

    const priceNum = parseNumber(price);
    const feeNum = parseNumber(feePercent);
    const baseNum = parseNumber(baseAmount) ?? 0;
    const quoteNum = parseNumber(quoteAmount) ?? 0;

    const feeValid = feeNum !== undefined && feeNum >= 0 && feeNum < 100;
    const reservesValid = baseNum + quoteNum > 0;
    const canApply =
      !submitting && !busy && priceNum !== undefined && priceNum > 0 && feeValid && reservesValid;

    const onApply = async () => {
      if (priceNum === undefined || feeNum === undefined) {
        return;
      }
      setSubmitting(true);
      try {
        const { position: newPosition } = planToPosition(
          {
            baseAsset: { id: prefill.baseAssetId, exponent: prefill.baseExponent },
            quoteAsset: { id: prefill.quoteAssetId, exponent: prefill.quoteExponent },
            price: priceNum,
            feeBps: Math.round(feeNum * 100),
            baseReserves: baseNum,
            quoteReserves: quoteNum,
          },
          LiquidityDistributionShape.FLAT,
        );
        const result = await editPosition({
          oldPositionId: id,
          newPosition,
          shape: LiquidityDistributionShape.FLAT,
        });
        // Close the modal only on success — leave it open on cancelled/busy/error
        // so the user can adjust and retry without re-opening.
        if (result.status === 'ok') {
          onClose();
        }
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Dialog isOpen={isOpen} onClose={onClose}>
        <Dialog.Content
          title='Edit position'
          buttons={
            <div className='flex w-full flex-col gap-2 px-6 pb-6'>
              <Button actionType='accent' disabled={!canApply} onClick={() => void onApply()}>
                Apply
              </Button>
              <Button priority='secondary' onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
            </div>
          }
        >
          <div className='flex flex-col gap-3'>
            <Text small color='text.secondary'>
              Closes the current position and opens a new one with these parameters in a single
              transaction.
            </Text>
            <OrderInput
              round
              label='Price'
              value={price}
              onChange={setPrice}
              decimals={prefill.quoteExponent}
              denominator={`${prefill.quoteSymbol} / ${prefill.baseSymbol}`}
            />
            <OrderInput
              label='Fee tier'
              value={feePercent}
              onChange={setFeePercent}
              denominator='%'
            />
            <OrderInput
              round
              label={`${prefill.baseSymbol} amount`}
              value={baseAmount}
              onChange={setBaseAmount}
              decimals={prefill.baseExponent}
              denominator={prefill.baseSymbol}
            />
            <OrderInput
              round
              label={`${prefill.quoteSymbol} amount`}
              value={quoteAmount}
              onChange={setQuoteAmount}
              decimals={prefill.quoteExponent}
              denominator={prefill.quoteSymbol}
            />
            <div className='mt-2'>
              <InfoRow
                label='Action'
                value='Close + reopen (atomic)'
                toolTip='The transaction closes the existing position and opens the new one in one signing step. If you cancel, neither change applies.'
              />
            </div>
          </div>
        </Dialog.Content>
      </Dialog>
    );
  },
);

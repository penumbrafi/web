'use client';

import { observer } from 'mobx-react-lite';
import { Density } from '@penumbra-zone/ui/Density';
import { TableCell } from '@penumbra-zone/ui/TableCell';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getValidatorInfoFromValueView } from '@penumbra-zone/getters/value-view';
import {
  getIdentityKeyFromValidatorInfo,
  getValidator,
  getRateData,
} from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { pnum } from '@penumbra-zone/types/pnum';
import { ChevronRight } from 'lucide-react';
import { connectionStore } from '@/shared/model/connection';
import { useBalances } from '@/shared/api/balances';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';

interface Props {
  /** Price of UM in the assets-table numeraire (typically USDC). */
  umPrice?: number;
  /** Numeraire symbol displayed (e.g. 'USDC'). */
  umQuoteSymbol?: string;
}

/**
 * Per-validator staking rows, rendered as siblings of the AssetsTable's
 * 7-col subgrid so the column widths line up exactly with the regular
 * asset rows.
 *
 * Reuses the shielded-balance column for the staked delUM amount and the
 * shielded-value column for the UM-denominated value (delUM × validator
 * exchange rate × UM price). Clicking a row sets a pending undelegate on
 * `stakingStore`; the `<StakingDialogHost>` mounted on the same page
 * resolves it to a real dialog in-place, so the user never leaves the
 * portfolio.
 */
export const DelegationRows = observer(({ umPrice, umQuoteSymbol = '-' }: Props) => {
  const subaccount = connectionStore.subaccount;
  const { data: balances } = useBalances(subaccount);
  const { data: delegations = [] } = useDelegations(balances);

  if (!delegations.length) return null;

  return (
    <Density compact>
      <div className='col-span-7 grid grid-cols-subgrid border-t border-t-other-tonal-stroke'>
        <TableCell variant='cell'>
          <Text detail color='text.secondary'>
            Staked
          </Text>
        </TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
      </div>

      {delegations.map((d, i) => (
        <DelegationRow
          key={i}
          delegation={d}
          umPrice={umPrice}
          umQuoteSymbol={umQuoteSymbol}
          isLast={i === delegations.length - 1}
        />
      ))}
    </Density>
  );
});

interface RowProps {
  delegation: ValueView;
  umPrice?: number;
  umQuoteSymbol: string;
  isLast: boolean;
}

const DelegationRow = ({ delegation, umPrice, umQuoteSymbol, isLast }: RowProps) => {
  // Pull validator info + exchange rate off the delegation token's ValueView.
  let validatorName = 'Unknown validator';
  let identityKey = '';
  let umEquivalent = 0;
  try {
    const info = getValidatorInfoFromValueView(delegation);
    const v = getValidator(info);
    validatorName = v.name || validatorName;
    identityKey = bech32mIdentityKey(getIdentityKeyFromValidatorInfo(info));
    const rate = getRateData(info);
    const rateBps2 = rate.validatorExchangeRate
      ? Number(joinLoHiAmount(rate.validatorExchangeRate))
      : 0;
    const delAmount = pnum(delegation).toNumber();
    umEquivalent = delAmount * (rateBps2 / 1e8);
  } catch {
    // best-effort: render the row even if the rate decode fails
  }

  const valueInQuote = umPrice ? umEquivalent * umPrice : 0;
  const borderClass = isLast ? '' : 'border-b border-b-other-tonal-stroke';
  const onClick = () => {
    if (!identityKey) return;
    stakingStore.setPending({ action: 'undelegate', identityKey });
  };

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={!identityKey}
      className={`group col-span-7 grid grid-cols-subgrid text-left hover:bg-action-hover-overlay ${borderClass}`}
    >
      <TableCell variant='cell'>
        <div className='flex flex-col gap-0.5'>
          <ValueViewComponent
            valueView={delegation}
            trailingZeros={false}
            priority='tertiary'
            density='compact'
          />
          <Text detail color='text.secondary'>
            {validatorName}
          </Text>
        </div>
      </TableCell>
      <TableCell variant='cell'>
        <Text variant='smallTechnical' color='text.secondary'>
          —
        </Text>
      </TableCell>
      <TableCell variant='cell'>
        {umPrice ? (
          <Text variant='smallTechnical' color='text.secondary'>
            {umPrice.toFixed(4)} {umQuoteSymbol}
          </Text>
        ) : (
          <Text variant='smallTechnical' color='text.secondary'>
            —
          </Text>
        )}
      </TableCell>
      <TableCell variant='cell'>
        {umEquivalent > 0 ? (
          <div className='flex flex-col gap-0.5'>
            <Text variant='smallTechnical' color='text.primary'>
              {umEquivalent.toFixed(4)} UM
            </Text>
            {valueInQuote > 0 && (
              <Text detail color='text.secondary'>
                ≈ {valueInQuote.toFixed(2)} {umQuoteSymbol}
              </Text>
            )}
          </div>
        ) : (
          <Text variant='smallTechnical' color='text.secondary'>
            —
          </Text>
        )}
      </TableCell>
      <TableCell variant='cell'>
        <Text variant='smallTechnical' color='text.secondary'>
          —
        </Text>
      </TableCell>
      <TableCell variant='cell'>
        {valueInQuote > 0 ? (
          <Text variant='smallTechnical' color='text.secondary'>
            {valueInQuote.toFixed(2)} {umQuoteSymbol}
          </Text>
        ) : (
          <Text variant='smallTechnical' color='text.secondary'>
            —
          </Text>
        )}
      </TableCell>
      <TableCell variant='cell'>
        <ChevronRight className='h-4 w-4 text-text-secondary transition-transform group-hover:translate-x-0.5' />
      </TableCell>
    </button>
  );
};

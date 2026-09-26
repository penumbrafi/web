'use client';

import { observer } from 'mobx-react-lite';
import { Density } from '@penumbra-zone/ui/Density';
import { TableCell } from '@penumbra-zone/ui/TableCell';
import { Text } from '@penumbra-zone/ui/Text';
import { ValueViewComponent } from '@penumbra-zone/ui/ValueView';
import { Sensitive } from '@/shared/ui/sensitive';
import { ValueView } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { getAmount, getValidatorInfoFromValueView } from '@penumbra-zone/getters/value-view';
import {
  getIdentityKeyFromValidatorInfo,
  getValidator,
  getRateData,
} from '@penumbra-zone/getters/validator-info';
import { bech32mIdentityKey } from '@penumbra-zone/bech32m/penumbravalid';
import { joinLoHiAmount } from '@penumbra-zone/types/amount';
import { pnum } from '@penumbra-zone/types/pnum';
import { Button } from '@penumbra-zone/ui/Button';
import { connectionStore } from '@/shared/model/connection';
import { useBalances } from '@/shared/api/balances';
import { useDelegations } from '@/pages/portfolio/staking/api/use-delegations';
import { stakingStore } from '@/pages/portfolio/staking/model/staking-store';
import {
  formatDuration,
  useUnbondingSchedule,
  type UnbondingEntry,
} from '@/pages/portfolio/staking/api/use-unbonding-schedule';
import { useStakingTokenMetadata } from '@/shared/api/registry';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';

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
 * exchange rate × UM price). "Stake more" / "Unstake" set a pending action on
 * `stakingStore`; the `<StakingDialogHost>` mounted on the same page
 * resolves it to a real dialog in-place, so the user never leaves the
 * portfolio.
 */
export const DelegationRows = observer(({ umPrice, umQuoteSymbol = '-' }: Props) => {
  const subaccount = connectionStore.subaccount;
  const { data: balances } = useBalances(subaccount);
  const { data: delegations = [] } = useDelegations(balances);
  const { entries: unbonding } = useUnbondingSchedule();

  if (!delegations.length && !unbonding.length) {
    return null;
  }

  return (
    <Density compact>
      {delegations.length > 0 && (
        <>
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
        </>
      )}
      {unbonding.length > 0 && <UnbondingRows entries={unbonding} />}
    </Density>
  );
});

/**
 * Unstaked UM on its way back, one row per validator: how much, from whom,
 * and when it can be claimed. Lived in a separate card above the page that
 * said only "Unbonding 106.94 UM".
 */
const UnbondingRows = observer(({ entries }: { entries: UnbondingEntry[] }) => {
  const { data: umMetadata } = useStakingTokenMetadata();
  const ready = entries.filter(e => e.claimable);

  return (
    <>
      <div className='col-span-7 grid grid-cols-subgrid border-t border-t-other-tonal-stroke'>
        <TableCell variant='cell'>
          <Text detail color='text.secondary'>
            Unbonding
          </Text>
        </TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>&nbsp;</TableCell>
        <TableCell variant='cell'>
          {ready.length > 1 && (
            <Button
              density='slim'
              actionType='accent'
              disabled={stakingStore.submitting}
              onClick={() => void stakingStore.claimUnbonded(ready.map(e => e.token))}
            >
              Claim all
            </Button>
          )}
        </TableCell>
      </div>
      {entries.map((e, i) => {
        const amount = new ValueView({
          valueView: {
            case: 'knownAssetId',
            value: { amount: getAmount(e.token), metadata: umMetadata },
          },
        });
        let when = 'Working out when…';
        if (e.claimable) {
          when = 'Ready to claim';
        } else if (e.msLeft !== undefined) {
          when = `Ready in ~${formatDuration(e.msLeft)}`;
        }
        const tip = e.claimable
          ? 'Claim to get the UM back into your balance.'
          : `Unstaked UM unlocks after the unbonding period${
              e.readyAtHeight ? `, around block ${e.readyAtHeight.toLocaleString()}` : ''
            }${e.msLeft !== undefined ? ` (~${formatDuration(e.msLeft)} from now)` : ''}.`;
        return (
          <div
            key={i}
            className={`col-span-7 grid grid-cols-subgrid ${
              i === entries.length - 1 ? '' : 'border-b border-b-other-tonal-stroke'
            }`}
          >
            <TableCell variant='cell'>
              {/* The validator is the hover text, keeping the row to one line. */}
              <div
                title={`Unbonding from ${e.validatorName}`}
                aria-label={`Unbonding from ${e.validatorName}`}
              >
                <Sensitive>
                  <ValueViewComponent
                    valueView={amount}
                    trailingZeros={false}
                    priority='tertiary'
                    density='compact'
                  />
                </Sensitive>
              </div>
            </TableCell>
            <TableCell variant='cell'>
              <Text
                variant='smallTechnical'
                color={e.claimable ? 'success.light' : 'text.secondary'}
              >
                {when}
              </Text>
            </TableCell>
            <TableCell variant='cell'>&nbsp;</TableCell>
            <TableCell variant='cell'>&nbsp;</TableCell>
            <TableCell variant='cell'>&nbsp;</TableCell>
            <TableCell variant='cell'>&nbsp;</TableCell>
            <TableCell variant='cell'>
              <Tooltip message={tip}>
                {/* span: a disabled button fires no hover, so the tip would never show */}
                <span>
                  <Button
                    density='slim'
                    actionType={e.claimable ? 'accent' : 'default'}
                    disabled={!e.claimable || stakingStore.submitting}
                    onClick={() => void stakingStore.claimUnbonded([e.token])}
                  >
                    Claim
                  </Button>
                </span>
              </Tooltip>
            </TableCell>
          </div>
        );
      })}
    </>
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
  // Explicit actions, not a clickable row: a click anywhere on the row used
  // to open Undelegate, the least-reversible thing you can do to a stake.
  const open = (action: 'delegate' | 'undelegate') => {
    if (!identityKey) {
      return;
    }
    stakingStore.setPending({ action, identityKey });
  };

  return (
    <div className={`col-span-7 grid grid-cols-subgrid text-left ${borderClass}`}>
      <TableCell variant='cell'>
        <div className='flex flex-col gap-0.5'>
          <Sensitive>
            <ValueViewComponent
              valueView={delegation}
              trailingZeros={false}
              priority='tertiary'
              density='compact'
            />
          </Sensitive>
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
              <Sensitive>{umEquivalent.toFixed(4)} UM</Sensitive>
            </Text>
            {valueInQuote > 0 && (
              <Text detail color='text.secondary'>
                <Sensitive>
                  ≈ {valueInQuote.toFixed(2)} {umQuoteSymbol}
                </Sensitive>
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
            <Sensitive>
              {valueInQuote.toFixed(2)} {umQuoteSymbol}
            </Sensitive>
          </Text>
        ) : (
          <Text variant='smallTechnical' color='text.secondary'>
            —
          </Text>
        )}
      </TableCell>
      <TableCell variant='cell'>
        <div className='flex gap-1'>
          <Button density='slim' disabled={!identityKey} onClick={() => open('delegate')}>
            Stake more
          </Button>
          <Button density='slim' disabled={!identityKey} onClick={() => open('undelegate')}>
            Unstake
          </Button>
        </div>
      </TableCell>
    </div>
  );
};

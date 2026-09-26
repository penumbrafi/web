'use client';

import { Link2Icon, Lock, LockOpen } from 'lucide-react';
import Link from 'next/link';
import { observer } from 'mobx-react-lite';
import { FC, useMemo, useState } from 'react';
import dayjs from '@/pages/inspect/explorer/lib/dayjs';
import { TransformedTransactionFragment } from '@/pages/inspect/explorer/lib/types';
import { classNames, formatNumber, shortenHash } from '@/pages/inspect/explorer/lib/utils';
import { useOwnTxInfo } from '@/shared/api/use-own-tx-info';
import ActionHistory from '../../actionHistory';
import CopyToClipboard from '../../copyToClipboard';
import JsonTree from '../../jsonTree';
import Memo from '../../memo';
import { Parameter, Parameters } from '../../parameters';
import Subsection from '../../subsection';
import { View, ViewProps } from '../view';

export interface Props extends Pick<ViewProps, 'className'> {
  transaction: TransformedTransactionFragment;
}

/**
 * One transaction page. Public by default; when the connected wallet took
 * part in the transaction, Decrypt re-renders this same view with the
 * wallet's data: the actions become the decrypted ones (amounts, assets,
 * counterparties), the memo shows its text, and Raw JSON shows the decrypted
 * view. Decryption happens in the wallet; veil's server sees nothing new.
 */
const TransactionView: FC<Props> = observer(props => {
  const own = useOwnTxInfo(props.transaction.hash);
  const [decrypted, setDecrypted] = useState(false);
  const mine = decrypted && own ? own : undefined;

  const memoText =
    mine?.view?.bodyView?.memoView?.memoView.case === 'visible'
      ? (mine.view.bodyView.memoView.memoView.value.plaintext?.text ?? '')
      : undefined;
  const decryptedJson = useMemo(
    () => (mine?.view ? (mine.view.toJson() as object) : undefined),
    [mine],
  );

  return (
    <View
      className={classNames(
        'from-[rgba(193,166,204,0.25)] to-[rgba(193,166,204,0.03)]',
        props.className,
      )}
      title={mine ? 'Transaction view (decrypted)' : 'Transaction view'}
      headerEnd={
        own && (
          <button
            type='button'
            onClick={() => setDecrypted(d => !d)}
            aria-pressed={decrypted}
            title={
              decrypted
                ? 'Back to what the chain shows everyone'
                : 'Your transaction: your wallet can decrypt it. Only you see the result.'
            }
            className='flex items-center gap-1.5 rounded-sm bg-other-tonal-fill10 px-3 py-1.5 text-sm text-text-primary hover:bg-other-tonal-fill15'
          >
            {decrypted ? <Lock size={14} /> : <LockOpen size={14} />}
            {decrypted ? 'Public view' : 'Decrypt'}
          </button>
        )
      }
    >
      <Parameters className='rounded-sm bg-other-tonal-fill5 p-3'>
        <Parameter name='Transaction hash'>
          {shortenHash(props.transaction.hash, 16)}
          <CopyToClipboard
            className='-mr-[5px] text-text-primary'
            text={props.transaction.hash}
            small
          />
        </Parameter>
        <Parameter name='Block height'>
          <Link
            className={classNames(
              'inline-flex items-center gap-2 text-inherit',
              'hover:text-primary-light',
            )}
            href={`/explore/block/${props.transaction.blockHeight}`}
          >
            {formatNumber(props.transaction.blockHeight)}
            <Link2Icon className='text-text-primary' size={12} />
          </Link>
        </Parameter>
        <Parameter name='Time'>
          {dayjs(props.transaction.timestamp).tz('UTC').format('YYYY-MM-DD HH:mm:ss z')}
        </Parameter>
      </Parameters>
      {props.transaction.memo && <Memo text={memoText} />}
      <ActionHistory
        blockHeight={props.transaction.blockHeight}
        hash={props.transaction.hash}
        rawTransaction={props.transaction.raw}
        view={mine?.view}
      />
      <Subsection title='Parameters'>
        <Parameters className='rounded-sm bg-other-tonal-fill5 p-3'>
          <Parameter name='Transaction fee'>{props.transaction.fee / 1000000} UM</Parameter>
          <Parameter name='Chain ID'>{props.transaction.chainId}</Parameter>
        </Parameters>
      </Subsection>
      <JsonTree
        data={decryptedJson ?? props.transaction.rawJson}
        title={decryptedJson ? 'Raw JSON (decrypted view)' : 'Raw JSON'}
      />
    </View>
  );
});

export default TransactionView;

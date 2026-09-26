// istanbul ignore file
import { FC } from 'react';
import { Encrypted } from '../vectors';
import { classNames } from '@/pages/inspect/explorer/lib/utils';
import Subsection from '../subsection';

const Memo: FC<{ text?: string }> = ({ text }) => (
  <Subsection title='Memo'>
    <div
      className={classNames(
        'bg-other-tonal-fill5 flex items-center gap-1 rounded-sm px-3',
        'text-text-secondary py-2',
      )}
    >
      {text === undefined ? (
        <>
          <Encrypted />
          <span className='font-mono text-sm font-medium'>Memo</span>
        </>
      ) : (
        <span className='text-sm break-words whitespace-pre-wrap text-text-primary'>
          {text || '(empty memo)'}
        </span>
      )}
    </div>
  </Subsection>
);

export default Memo;

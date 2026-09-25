'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowLeftRight, QrCode, Send } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { BalancesResponse } from '@penumbra-zone/protobuf/penumbra/view/v1/view_pb';
import { connectionStore } from '@/shared/model/connection';
import { SendPanel } from './send-panel';
import { SwapPanel } from './swap-panel';
import { ReceivePanel } from './receive-panel';

/**
 * Send and Swap for one shielded token, opened as modals from its row in the
 * Assets table. They start on that token; the selector inside still allows
 * switching.
 */
export const ShieldedAssetActions = ({ balance }: { balance: BalancesResponse }) => {
  const [sendOpen, setSendOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);

  return (
    <div className='flex gap-2'>
      <Button density='slim' priority='secondary' icon={Send} onClick={() => setSendOpen(true)}>
        Send
      </Button>
      <Button
        density='slim'
        priority='secondary'
        icon={ArrowLeftRight}
        onClick={() => setSwapOpen(true)}
      >
        Swap
      </Button>

      <Dialog isOpen={sendOpen} onClose={() => setSendOpen(false)}>
        <Dialog.Content title='Send'>
          {sendOpen && <SendPanel initialBalance={balance} onSent={() => setSendOpen(false)} />}
        </Dialog.Content>
      </Dialog>

      <Dialog isOpen={swapOpen} onClose={() => setSwapOpen(false)}>
        <Dialog.Content title='Swap'>
          {swapOpen && <SwapPanel initialBalance={balance} onSwapped={() => setSwapOpen(false)} />}
        </Dialog.Content>
      </Dialog>
    </div>
  );
};

/**
 * Receive is account-wide, not per token, so it sits in the Assets header.
 * Only on an explicit click: it shows a Penumbra address, which an exchange
 * user must not mistake for a deposit address.
 */
export const ReceiveButton = observer(() => {
  const [open, setOpen] = useState(false);

  if (!connectionStore.connected) {
    return null;
  }

  return (
    <>
      <Button density='compact' priority='secondary' icon={QrCode} onClick={() => setOpen(true)}>
        Receive
      </Button>
      <Dialog isOpen={open} onClose={() => setOpen(false)}>
        <Dialog.Content title='Receive'>{open && <ReceivePanel />}</Dialog.Content>
      </Dialog>
    </>
  );
});

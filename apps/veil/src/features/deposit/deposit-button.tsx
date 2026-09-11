'use client';

import { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDownToLine } from 'lucide-react';
import { Button, ButtonProps } from '@penumbra-zone/ui/Button';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import dynamic from 'next/dynamic';
import { connectionStore } from '@/shared/model/connection';

// Defer loading the modal markup until needed, but eagerly warm the chunk
// cache on hover/focus so the click→modal latency disappears (was ~3s).
const DepositDialog = dynamic(
  () => import('./deposit-dialog').then(mod => ({ default: mod.DepositDialog })),
  { ssr: false },
);

const preloadDialog = () => {
  // Webpack chunk import is idempotent — calling it more than once just hits
  // the in-memory cache.
  void import('./deposit-dialog');
};

interface DepositButtonProps {
  variant?: 'default' | 'minimal' | 'mobile';
  actionType?: ButtonProps['actionType'];
  children?: React.ReactNode;
}

export const DepositButton = observer(
  ({ variant = 'default', actionType = 'accent', children }: DepositButtonProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const connected = connectionStore.connected;

    // Warm the deposit-dialog chunk shortly after the button mounts (idle
    // browser time) so the first click is instant. Cheap to do — the chunk
    // is fetched once per session and reused for every button instance.
    useEffect(() => {
      const idleId = (window.requestIdleCallback ?? window.setTimeout)(preloadDialog, {
        timeout: 2000,
      });
      return () => {
        const cancel = window.cancelIdleCallback ?? window.clearTimeout;
        cancel(idleId as number);
      };
    }, []);

    // Belt-and-suspenders: also fire on hover/focus in case idle callback
    // hasn't run yet. Idempotent.
    const onPointerEnter = useCallback(preloadDialog, []);

    // mobile = always icon-only.
    // minimal in header (no children) = icon-only so it doesn't overflow.
    // minimal with children (e.g. portfolio "Deposit") = labelled.
    const iconOnly = variant === 'mobile' || (variant === 'minimal' && !children);

    const button = (
      <Button
        icon={ArrowDownToLine}
        iconOnly={iconOnly}
        actionType={actionType}
        density={variant === 'minimal' ? 'compact' : 'sparse'}
        priority={variant === 'minimal' ? 'secondary' : 'primary'}
        disabled={!connected}
        onClick={() => setIsOpen(true)}
      >
        {children ?? 'Deposit'}
      </Button>
    );

    return (
      <span onPointerEnter={onPointerEnter} onFocus={onPointerEnter}>
        {connected ? (
          button
        ) : (
          <Tooltip message='Connect your Penumbra wallet to deposit funds'>
            {button}
          </Tooltip>
        )}

        {isOpen && <DepositDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />}
      </span>
    );
  },
);

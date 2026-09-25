'use client';

import cn from 'clsx';
import { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@penumbra-zone/ui/Button';
import { balanceVisibility } from '@/shared/model/balance-visibility';

/**
 * Wraps an amount the user may want hidden (balances, values, PnL). When
 * hiding is on it is blurred; hovering or keyboard-focusing it reveals just
 * that one value. Blur rather than '••••' so the layout never shifts.
 */
export const Sensitive = observer(
  ({ children, className }: { children: ReactNode; className?: string }) => {
    if (!balanceVisibility.hidden) {
      return <>{children}</>;
    }
    return (
      <span
        tabIndex={0}
        aria-label='Hidden value, hover or focus to reveal'
        className={cn(
          'inline-flex cursor-default blur-sm transition-[filter] duration-150 outline-none select-none hover:blur-none hover:select-auto focus-visible:blur-none',
          className,
        )}
      >
        {children}
      </span>
    );
  },
);

export const BalanceVisibilityToggle = observer(() => (
  <Button
    iconOnly
    density='compact'
    priority='secondary'
    icon={balanceVisibility.hidden ? EyeOff : Eye}
    onClick={() => balanceVisibility.toggle()}
  >
    {balanceVisibility.hidden ? 'Show balances' : 'Hide balances'}
  </Button>
));

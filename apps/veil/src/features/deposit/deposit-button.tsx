'use client';

import { ArrowDownToLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button, ButtonProps } from '@penumbra-zone/ui/Button';

interface DepositButtonProps {
  variant?: 'default' | 'minimal' | 'mobile';
  actionType?: ButtonProps['actionType'];
  children?: React.ReactNode;
}

/**
 * Every "Deposit" button opens the same flow: /portfolio/deposit.
 *
 * This used to open a separate dialog with its own route picker, which
 * showed a Penumbra address under "Deposit from Injective" - the exact
 * address an exchange user must never paste into a withdrawal form - and
 * was disabled until Zafu connected, while the page it contradicted was
 * not. One entry point, one set of rules.
 */
export const DepositButton = ({
  variant = 'default',
  actionType = 'accent',
  children,
}: DepositButtonProps) => {
  const router = useRouter();

  // mobile = always icon-only.
  // minimal in header (no children) = icon-only so it doesn't overflow.
  // minimal with children (e.g. portfolio "Deposit") = labelled.
  const iconOnly = variant === 'mobile' || (variant === 'minimal' && !children);

  return (
    <Button
      icon={ArrowDownToLine}
      iconOnly={iconOnly}
      actionType={actionType}
      density={variant === 'minimal' ? 'compact' : 'sparse'}
      priority={variant === 'minimal' ? 'secondary' : 'primary'}
      onClick={() => router.push('/portfolio/deposit')}
    >
      {children ?? 'Deposit'}
    </Button>
  );
};

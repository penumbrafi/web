import { ReactNode, memo, useCallback, useEffect, useRef } from 'react';
import { Dialog } from '@penumbra-zone/ui/Dialog';
import { Text } from '@penumbra-zone/ui/Text';
import { Button } from '@penumbra-zone/ui/Button';
import { InfoRow } from './info-row';

export interface ConfirmInfoRow {
  label: string;
  value: string;
  valueColor?: 'success' | 'error';
  toolTip?: ReactNode;
}

export interface ConfirmWarning {
  /** Stable key for list reconciliation. */
  key: string;
  message: string;
}

export interface ConfirmOrderModalProps {
  isOpen: boolean;
  /** Headline for the trade — e.g. "Buy 1.0 UM at 0.124 USDC". */
  actionLabel: string;
  /** Optional sub-line under the headline (e.g. mid-price reference). */
  subLabel?: string;
  rows: ConfirmInfoRow[];
  warnings?: ConfirmWarning[];
  /** Disable Confirm while a previous submit is still resolving. */
  confirmDisabled?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmOrderModal = memo(
  ({
    isOpen,
    actionLabel,
    subLabel,
    rows,
    warnings,
    confirmDisabled,
    confirmLabel = 'Confirm',
    onConfirm,
    onCancel,
  }: ConfirmOrderModalProps) => {
    const wrapRef = useRef<HTMLDivElement>(null);

    // Radix Dialog focuses the first focusable child by default; jump
    // focus to Confirm so Enter ⏎ fires the broadcast immediately.
    useEffect(() => {
      if (!isOpen) {
        return;
      }
      const id = window.setTimeout(() => {
        const btn = wrapRef.current?.querySelector<HTMLButtonElement>(
          'button[data-confirm="true"]',
        );
        btn?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }, [isOpen]);

    // Enter on any focusable child fires Confirm. Radix Dialog already
    // handles Esc + click-outside via onClose.
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' && !confirmDisabled) {
          e.preventDefault();
          onConfirm();
        }
      },
      [confirmDisabled, onConfirm],
    );

    return (
      <Dialog isOpen={isOpen} onClose={onCancel}>
        <Dialog.Content title='Confirm order'>
          <div ref={wrapRef} onKeyDown={handleKeyDown} className='flex flex-col gap-4'>
            <div className='flex flex-col gap-1'>
              <Text body color='text.primary'>
                {actionLabel}
              </Text>
              {subLabel && (
                <Text small color='text.secondary'>
                  {subLabel}
                </Text>
              )}
            </div>

            {rows.length > 0 && (
              <div className='rounded-sm border border-other-tonal-stroke px-3 py-2'>
                {rows.map(row => (
                  <InfoRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    valueColor={row.valueColor}
                    toolTip={row.toolTip}
                  />
                ))}
              </div>
            )}

            {warnings && warnings.length > 0 && (
              <div className='flex flex-col gap-2'>
                {warnings.map(w => (
                  <div
                    key={w.key}
                    className='rounded-sm border border-destructive-light bg-destructive-light/5 px-3 py-2'
                  >
                    <Text small color='destructive.light'>
                      {w.message}
                    </Text>
                  </div>
                ))}
              </div>
            )}

            <div className='mt-2 flex gap-2'>
              <Button actionType='default' priority='secondary' onClick={onCancel}>
                Cancel
              </Button>
              <span data-confirm='true' className='contents'>
                <Button
                  actionType='accent'
                  priority='primary'
                  disabled={confirmDisabled}
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              </span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog>
    );
  },
);

ConfirmOrderModal.displayName = 'ConfirmOrderModal';

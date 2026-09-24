import { ReactNode } from 'react';
import {
  Overlay as RadixDialogOverlay,
  Portal as RadixDialogPortal,
  Content as RadixDialogContent,
  Title as RadixDialogTitle,
} from '@radix-ui/react-dialog';

export interface DialogEmptyContentProps {
  children?: ReactNode;
  /**
   * Accessible name for the dialog, announced by screen readers but not shown.
   * `Dialog.Content` renders its own visible title and leaves this unset; any
   * other caller should set it, or the dialog opens with no name at all.
   */
  title?: string;
  /** @deprecated this prop will be removed in the future */
  zIndex?: number;
}

export const EmptyContent = ({ children, title, zIndex }: DialogEmptyContentProps) => {
  return (
    <RadixDialogPortal>
      <RadixDialogOverlay className='fixed inset-0 z-auto bg-other-overlay backdrop-blur-xs' />

      {/*
        * `aria-describedby={undefined}` is Radix's documented opt-out: none of
        * these dialogs carry a Description, and without it Radix warns on every
        * open. Callers that do want one can render their own and wire it up.
        */}
      <RadixDialogContent aria-describedby={undefined}>
        {title && <RadixDialogTitle className='sr-only'>{title}</RadixDialogTitle>}
        <div className='pointer-events-none fixed inset-0' style={{ zIndex }}>
          {children}
        </div>
      </RadixDialogContent>
    </RadixDialogPortal>
  );
};

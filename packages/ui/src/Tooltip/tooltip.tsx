import * as RadixTooltip from '@radix-ui/react-tooltip';
import { ReactNode } from 'react';
import cn from 'clsx';
import { Text } from '../Text';
import { buttonBase } from '../utils/button';
import { small } from '../utils/typography';

export interface TooltipProps {
  /** An optional title to show in larger text above the message. */
  title?: string;
  /**
   * A string message to show in the tooltip. Note that only strings are
   * allowed; for interactive content, use a `<Popover />` or a `<Dialog />`.
   */
  message: string | ReactNode;
  /**
   * The trigger for the tooltip.
   *
   * Note that the trigger will be wrapped in an HTML button element, so only pass content that can be validly nested inside a button (i.e., don't pass another button).
   * With `asChild`, it isn't wrapped: pass a single element, which becomes the trigger.
   */
  children: ReactNode;
  /**
   * Use `children` (a single element) as the trigger instead of wrapping it
   * in a button: for a tooltip on something that already sits inside a
   * button, where a nested button would be invalid HTML.
   */
  asChild?: boolean;
}

/**
 * Use this for small informational text that should appear adjacent to a piece
 * of content.
 *
 * ```tsx
 * <Tooltip title="Tooltip title" message="Tooltip message">
 *   Hover me
 * </Tooltip>
 * ```
 *
 * ## Differences between `<Dialog />`, `<Popover />`, and `<Tooltip />`.
 *
 * These three components provide similar functionality, but are meant to be
 * used in distinct ways.
 *
 * - `<Dialog />`: Use dialogs for interactive or informational content that
 * should take the user's attention above everything else on the page. Dialogs
 * are typically opened in response to a click from a user, but may also be
 * opened and closed programmatically.
 * - `<Popover />`: Use popovers for interactive or informational content that
 * should be visually tied to a specific element on the page, such as the
 * dropdown menu underneath the menu button. Popovers are typically opened in
 * response to a click from a user, but may also be opened and closed
 * programmatically.
 * - `<Tooltip />`: Use tooltips for plain-text informational content that
 * should be visually tied to a specific element on the page. Tooltips are
 * opened in response to the user hovering over that element.
 */
export const Tooltip = ({ title, message, children, asChild }: TooltipProps) => (
  <RadixTooltip.Root>
    {asChild ? (
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
    ) : (
      <RadixTooltip.Trigger className={buttonBase}>{children}</RadixTooltip.Trigger>
    )}
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={4}
        className={cn(
          'w-[200px] rounded-sm border border-other-tonal-stroke p-2 backdrop-blur-xl',
          'origin-(--radix-tooltip-content-transform-origin) bg-other-dialog-background text-text-primary',
          'animate-scale',
        )}
      >
        {title && <div className={cn(small, 'mb-2')}>{title}</div>}

        <Text detail>{message}</Text>
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  </RadixTooltip.Root>
);

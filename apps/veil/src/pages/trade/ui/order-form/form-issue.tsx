import { memo } from 'react';
import cn from 'clsx';
import { Text } from '@penumbra-zone/ui/Text';
import type { FormIssue } from './store/validate';

/**
 * The reason the submit button is disabled, said out loud.
 *
 * A greyed-out button with no explanation is the single worst state this form
 * can be in: the user has filled everything in, nothing happens, and there is
 * nowhere to look for why. This sits directly under the button so the answer
 * is where the question is asked.
 */
export const FormIssueNotice = memo(({ issue }: { issue?: FormIssue }) => {
  if (!issue) {
    return null;
  }

  const isBlocking = issue.severity === 'blocking';

  return (
    <div
      role={isBlocking ? 'alert' : 'status'}
      className={cn(
        'mt-2 rounded-sm border px-3 py-2',
        isBlocking
          ? 'border-destructive-light bg-destructive-light/5'
          : 'border-caution-light bg-caution-light/5',
      )}
    >
      <Text small color={isBlocking ? 'destructive.light' : 'caution.light'}>
        {issue.message}
      </Text>
    </div>
  );
});

FormIssueNotice.displayName = 'FormIssueNotice';

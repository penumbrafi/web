'use client';

import { format } from 'date-fns';

export const VeilVersion = () => {
  const commitHash = process.env.COMMIT_HASH || 'unknown';
  const commitDate = process.env.COMMIT_DATE || 'unknown';
  const gitOriginUrl = process.env.GIT_ORIGIN_URL || 'unknown';

  const shortHash = commitHash.substring(0, 7);
  const formattedDate =
    commitDate !== 'unknown'
      ? format(new Date(commitDate), "MMM dd yyyy HH:mm:ss 'GMT'x")
      : 'unknown';

  const originAvailable = gitOriginUrl !== 'unknown';
  const commitUrl = originAvailable ? `${gitOriginUrl}/commit/${commitHash}` : '#';
  // Fallback link: if the exact commit is orphaned on the remote (can
  // happen after a rebase-then-push), users can still reach the source
  // via `/tree/main` and see what's currently running mainline.
  const repoUrl = originAvailable ? gitOriginUrl : '#';

  return (
    <div className='flex flex-wrap items-center justify-center gap-x-2 text-xs text-text-secondary'>
      <span className='opacity-70'>Source:</span>
      {originAvailable ? (
        <a
          href={repoUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='underline decoration-dotted underline-offset-2 hover:text-text-primary'
        >
          {gitOriginUrl.replace(/^https?:\/\//, '')}
        </a>
      ) : (
        <span className='opacity-50'>unavailable</span>
      )}
      <span className='opacity-40'>·</span>
      <a
        href={commitUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='font-mono opacity-70 hover:text-text-primary hover:underline'
        title={`Commit ${commitHash}`}
      >
        {shortHash}
      </a>
      <span className='opacity-40'>·</span>
      <span className='opacity-50'>{formattedDate}</span>
    </div>
  );
};

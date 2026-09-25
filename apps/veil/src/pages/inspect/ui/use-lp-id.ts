'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/** The LP id from the route; redirects to /explore (after render) when it is missing. */
export const useLpIdInUrl = (): string => {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  useEffect(() => {
    if (!id) {
      router.push('/explore');
    }
  }, [id, router]);
  return id;
};
